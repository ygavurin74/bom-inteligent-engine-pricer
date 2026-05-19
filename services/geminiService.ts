
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ComponentInfo } from "../types";
import { DEFAULT_MODEL, MAX_RETRY_ATTEMPTS } from "../constants";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calls the Gemini API with search grounding to find detailed component information.
 * Uses responseSchema for structured data extraction.
 */
async function callGeminiApi(mpn: string, manufacturer?: string, quantity: string = '1', enableSearch: boolean = true): Promise<GenerateContentResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const manufacturerHint = manufacturer ? `Manufacturer: ${manufacturer}` : "Manufacturer: Not provided (identify from MPN)";
  
  const prompt = `Conduct an exhaustive search for the electronic component with Manufacturer Part Number (MPN): "${mpn}".
  ${manufacturerHint}
  Target Quantity Required: ${quantity} units.

  DISTRIBUTOR SEARCH (PRIORITY):
  Look for unit pricing for exactly ${quantity} units at these specific authorized US distributors:
  1. TTI (tti.com)
  2. Future Electronics (futureelectronics.com)
  3. Digi-Key (digikey.com)
  4. Mouser (mouser.com)
  5. Arrow Electronics (arrow.com)

  SPECIFIC FIELDS REQUIRED:
  - Find the lowest available 'unitPrice' for the requested quantity.
  - Record the price at EACH distributor listed above. If not found at a specific distributor, return "N/A".
  - Identify the Minimum Order Quantity (MOQ).
  - Look up the USA Import Tariff / HTS code.
  - Determine Lifecycle Status: Active, Obsolete, NRND, or EOL.
  - Provide a concise technical description.

  CONSTRAINTS:
  - 'midPrice' must be a raw number (floating point), no symbols.
  - Return ONLY valid JSON matching the schema provided.`;

  const config: any = {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        searchSuccess: { type: Type.BOOLEAN },
        validationNote: { type: Type.STRING },
        manufacturer: { type: Type.STRING },
        description: { type: Type.STRING },
        technology: { type: Type.STRING },
        unitPrice: { type: Type.STRING },
        midPrice: { type: Type.NUMBER },
        ttiPrice: { type: Type.STRING },
        futurePrice: { type: Type.STRING },
        digikeyPrice: { type: Type.STRING },
        mouserPrice: { type: Type.STRING },
        arrowPrice: { type: Type.STRING },
        moq: { type: Type.STRING },
        tariff: { type: Type.STRING },
        status: { type: Type.STRING },
        stockSource: { type: Type.STRING },
        leadTime: { type: Type.STRING },
        maxLeadTime: { type: Type.STRING },
      },
      required: ["searchSuccess", "manufacturer", "unitPrice", "midPrice"],
    },
  };

  if (enableSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  return await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config,
  });
}

/**
 * Fetches data for a single component with retry logic and error handling.
 */
export async function fetchComponentData(
  mpn: string, 
  manufacturer?: string, 
  quantity: string = '1',
  onRetry?: (delay: number, attempt: number) => void
): Promise<ComponentInfo> {
  let attempt = 0;
  const maxRetries = MAX_RETRY_ATTEMPTS;
  let delay = 3000;
  let useSearch = true;

  while (attempt <= maxRetries) {
    try {
      const response = await callGeminiApi(mpn, manufacturer, quantity, useSearch);
      const text = response.text;
      
      if (!text) {
        throw new Error("Model returned an empty response.");
      }
      
      let data: any;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text;
        data = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("Failed to parse JSON from response:", text);
        throw new Error("Could not parse component data from API response.");
      }

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .filter((chunk: any) => chunk.web)
        .map((chunk: any) => ({
          title: chunk.web.title,
          uri: chunk.web.uri,
        }));

      return {
        mpn,
        manufacturer: data.manufacturer || manufacturer || "Unknown",
        description: data.description || "N/A",
        technology: data.technology || "N/A",
        unitPrice: data.unitPrice || "N/A",
        midPrice: data.midPrice || 0,
        ttiPrice: data.ttiPrice || "N/A",
        futurePrice: data.futurePrice || "N/A",
        digikeyPrice: data.digikeyPrice || "N/A",
        mouserPrice: data.mouserPrice || "N/A",
        arrowPrice: data.arrowPrice || "N/A",
        moq: data.moq || "N/A",
        tariff: data.tariff || "N/A",
        status: data.status || "Unknown",
        stockSource: data.stockSource || "Unknown",
        leadTime: data.leadTime || "N/A",
        maxLeadTime: data.maxLeadTime || "0",
        sources,
        searchSuccess: !!data.searchSuccess,
        validationNote: data.validationNote || (!useSearch ? "Fallback: Used base model knowledge without live search." : "")
      };
    } catch (error: any) {
      const rawErrorStr = typeof error === 'string' ? error : JSON.stringify(error);
      const errorMsg = error?.message || error?.error?.message || rawErrorStr || "";
      const isQuotaExceeded = errorMsg.toLowerCase().includes('quota') || error?.status === 'RESOURCE_EXHAUSTED' || error?.error?.status === 'RESOURCE_EXHAUSTED';
      
      if (!isQuotaExceeded) {
        console.error(`Attempt ${attempt + 1} failed for ${mpn}:`, error);
      }
      
      if (isQuotaExceeded && useSearch) {
        console.warn(`Search quota exceeded for ${mpn}. Retrying without search.`);
        useSearch = false; // Disable search and retry immediately without delay increment
        continue;
      }
      
      const isRateLimit = (error?.status === 429 || error?.error?.code === 429 || errorMsg.includes('429')) && !isQuotaExceeded;
      const isServiceUnavailable = error?.status === 503 || error?.error?.code === 503 || errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE');
      const isInternalError = error?.status === 500 || error?.error?.code === 500 || error?.status === 'INTERNAL' || error?.error?.status === 'INTERNAL' || errorMsg.includes('500') || errorMsg.toLowerCase().includes('internal error');
      const isEmptyResponse = errorMsg.includes('empty response');
      
      if ((isRateLimit || isServiceUnavailable || isQuotaExceeded || isInternalError || isEmptyResponse) && attempt < maxRetries) {
        attempt++;
        const currentDelay = delay * Math.pow(1.5, attempt - 1);
        if (onRetry) onRetry(currentDelay, attempt);
        await sleep(currentDelay);
        continue;
      }

      const statusText = isQuotaExceeded ? "Quota Exceeded" : isServiceUnavailable ? "Service Unavailable (503)" : isInternalError ? "Internal Error (500)" : isRateLimit ? "Rate Limit (429)" : "Error";

      return {
        mpn,
        manufacturer: manufacturer || "Unknown",
        description: `Error: ${error.message?.substring(0, 100)}`,
        technology: "N/A",
        unitPrice: "N/A",
        midPrice: 0,
        ttiPrice: "N/A",
        futurePrice: "N/A",
        digikeyPrice: "N/A",
        mouserPrice: "N/A",
        arrowPrice: "N/A",
        moq: "N/A",
        tariff: "N/A",
        status: statusText,
        stockSource: "N/A",
        leadTime: "N/A",
        maxLeadTime: "0",
        sources: [],
        searchSuccess: false,
        validationNote: isQuotaExceeded ? "API Quota Exceeded for this tier." : isServiceUnavailable ? "Model experiencing high demand. Retries exhausted." : "API processing failed."
      };
    }
  }

  return {
    mpn,
    manufacturer: manufacturer || "Unknown",
    description: "Search failed after maximum retries.",
    technology: "N/A",
    unitPrice: "N/A",
    midPrice: 0,
    ttiPrice: "N/A",
    futurePrice: "N/A",
    digikeyPrice: "N/A",
    mouserPrice: "N/A",
    arrowPrice: "N/A",
    moq: "N/A",
    tariff: "N/A",
    status: "Timeout",
    stockSource: "N/A",
    leadTime: "N/A",
    maxLeadTime: "0",
    sources: [],
    searchSuccess: false,
    validationNote: "Processing limit reached."
  };
}
