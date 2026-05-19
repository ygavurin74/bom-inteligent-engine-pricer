
export interface ComponentInfo {
  mpn: string;
  manufacturer: string;
  description: string;
  technology: string;
  unitPrice: string; // Acts as "Best Market Price"
  midPrice: number;
  // Distributor specific prices
  ttiPrice: string;
  futurePrice: string;
  digikeyPrice: string;
  mouserPrice: string;
  arrowPrice: string;
  // Logistics info
  moq: string;
  tariff: string;
  status: string;
  stockSource: string;
  leadTime: string;
  maxLeadTime: string;
  sources: { title: string; uri: string }[];
  searchSuccess: boolean;
  validationNote?: string;
}

export interface SpreadsheetRow {
  [key: string]: any;
}

export interface ProcessingState {
  isProcessing: boolean;
  total: number;
  current: number;
  logs: string[];
}
