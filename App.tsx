
import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Play, Download, Loader2, Package, Landmark, Clock, ExternalLink, Info, SearchX, Square, Tag, RefreshCcw } from 'lucide-react';
import { parseExcel, exportToExcel } from './utils/excelUtils';
import { fetchComponentData } from './services/geminiService';
import { SpreadsheetRow, ComponentInfo, ProcessingState } from './types';

const App: React.FC = () => {
  const [data, setData] = useState<SpreadsheetRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [mpnColumn, setMpnColumn] = useState<string>('');
  const [mfrColumn, setMfrColumn] = useState<string>('');
  const [qtyColumn, setQtyColumn] = useState<string>('');
  const [enrichedData, setEnrichedData] = useState<ComponentInfo[]>([]);
  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    total: 0,
    current: 0,
    logs: [],
  });
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const stopRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('bomIntelBackup');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          setEnrichedData(parsed);
          setProcessing(prev => ({
            ...prev,
            logs: [`[${new Date().toLocaleTimeString()}] Extracted ${parsed.length} recovered items from previous session.`]
          }));
        }
      }
    } catch (e) {
      console.warn("Failed to parse backup data", e);
    }
  }, []);

  const [manualMpn, setManualMpn] = useState<string>('');

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMpn.trim()) return;
    
    const newData = [{ "MPN": manualMpn.trim() }];
    setData(newData);
    setMpnColumn("MPN");
    setMfrColumn("");
    setQtyColumn("");
    setFileName(`manual_${manualMpn.trim()}`);
    setManualMpn("");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name.replace(/\.[^/.]+$/, ""));
      try {
        const json = await parseExcel(file);
        if (json.length > 0) {
          setData(json);
          const keys = Object.keys(json[0]);
          setMpnColumn(keys.find(k => k.toLowerCase().includes('mpn') || k.toLowerCase().includes('part number')) || keys[0]);
          setMfrColumn(keys.find(k => k.toLowerCase().includes('mfr') || k.toLowerCase().includes('manufac')) || '');
          setQtyColumn(keys.find(k => k.toLowerCase().includes('qty') || k.toLowerCase().includes('quant')) || '');
        }
      } catch (err) {
        console.error("Error parsing excel", err);
        addLog("Error reading file. Please ensure it's a valid Excel or CSV file.");
      }
    }
  };

  const addLog = (message: string) => {
    setProcessing(prev => ({
      ...prev,
      logs: [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev.logs].slice(0, 100)
    }));
  };

  const startProcessing = async () => {
    if (!mpnColumn) return;
    
    setProcessing({
      isProcessing: true,
      total: data.length,
      current: 0,
      logs: [],
    });
    setEnrichedData([]);
    setIsStopping(false);
    stopRef.current = false;
    
    addLog(`Starting search for ${data.length} components...`);

    const results: ComponentInfo[] = [];
    
    for (let i = 0; i < data.length; i++) {
      if (stopRef.current) {
        addLog("Processing stopped by user.");
        break;
      }

      const row = data[i];
      const mpn = row[mpnColumn];
      const mfr = mfrColumn ? row[mfrColumn] : undefined;
      const qty = qtyColumn ? String(row[qtyColumn]) : '1';

      if (!mpn) {
        addLog(`Skipping row ${i + 1}: No MPN found.`);
        setProcessing(prev => ({ ...prev, current: i + 1 }));
        continue;
      }

      addLog(`Searching ${mpn}...`);
      
      const componentInfo = await fetchComponentData(
        mpn, 
        mfr, 
        qty, 
        (delay, attempt) => addLog(`Retrying ${mpn} due to service demand. Waiting ${(delay/1000).toFixed(1)}s (Attempt ${attempt})...`)
      );
      
      results.push(componentInfo);
      // Append only the newly processed component to avoid quadratic memory spikes
      setEnrichedData(prev => [...prev, componentInfo]);
      
      try {
        localStorage.setItem('bomIntelBackup', JSON.stringify(results));
      } catch (e) {
        console.warn('Failed to save backup to localStorage', e);
      }
      
      setProcessing(prev => ({ ...prev, current: i + 1 }));
      
      if (componentInfo.searchSuccess) {
        addLog(`✓ Found ${mpn} (${componentInfo.manufacturer})`);
      } else {
        addLog(`⚠ Issue with ${mpn}: ${componentInfo.validationNote || 'No results'}`);
        if (componentInfo.validationNote === 'API Quota Exceeded for this tier.') {
          addLog('Stopping analysis due to API quota exhaustion.');
          stopRef.current = true;
          break;
        }
      }
    }

    setProcessing(prev => ({ ...prev, isProcessing: false }));
    addLog("Processing complete.");

    if (results.length > 0) {
      addLog("Auto-exporting results to Excel...");
      const exportData = results.map(item => ({
        "MPN": item.mpn || 'Unknown',
        "Manufacturer": item.manufacturer || 'Unknown',
        "Description": item.description || '',
        "Status": item.status || 'Unknown',
        "MOQ": item.moq || 'N/A',
        "Tariff": item.tariff || 'N/A',
        "Best Market Price": item.unitPrice || 'N/A',
        "TTI Price": item.ttiPrice || 'N/A',
        "Future Price": item.futurePrice || 'N/A',
        "Digi-Key Price": item.digikeyPrice || 'N/A',
        "Mouser Price": item.mouserPrice || 'N/A',
        "Arrow Price": item.arrowPrice || 'N/A',
        "Lead Time": item.leadTime || 'N/A',
        "Max Lead Time": item.maxLeadTime || '0',
        "Technology": item.technology || '',
        "Validation Note": item.validationNote || '',
        "Sources": (item.sources || []).map(s => s.uri).join(', ')
      }));
      
      exportToExcel(exportData, fileName || 'component_search');
    }
  };

  const stopProcessing = () => {
    setIsStopping(true);
    stopRef.current = true;
  };

  const handleReset = () => {
    setData([]);
    setFileName('');
    setMpnColumn('');
    setMfrColumn('');
    setQtyColumn('');
    setEnrichedData([]);
    setProcessing({
      isProcessing: false,
      total: 0,
      current: 0,
      logs: [],
    });
    setManualMpn('');
    setIsStopping(false);
    stopRef.current = false;
    try {
      localStorage.removeItem('bomIntelBackup');
    } catch (e) {
      console.warn("Failed to clear backup data", e);
    }
  };

  const handleExport = () => {
    if (enrichedData.length === 0) return;
    
    const exportData = enrichedData.map(item => ({
      "MPN": item.mpn || 'Unknown',
      "Manufacturer": item.manufacturer || 'Unknown',
      "Description": item.description || '',
      "Status": item.status || 'Unknown',
      "MOQ": item.moq || 'N/A',
      "Tariff": item.tariff || 'N/A',
      "Best Market Price": item.unitPrice || 'N/A',
      "TTI Price": item.ttiPrice || 'N/A',
      "Future Price": item.futurePrice || 'N/A',
      "Digi-Key Price": item.digikeyPrice || 'N/A',
      "Mouser Price": item.mouserPrice || 'N/A',
      "Arrow Price": item.arrowPrice || 'N/A',
      "Lead Time": item.leadTime || 'N/A',
      "Max Lead Time": item.maxLeadTime || '0',
      "Technology": item.technology || '',
      "Validation Note": item.validationNote || '',
      "Sources": (item.sources || []).map(s => s.uri).join(', ')
    }));
    
    exportToExcel(exportData, fileName || 'component_search_partial');
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg">
              <Package className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">BOM Intel Engine</h1>
              <p className="text-slate-500 text-sm">Deep Market Analysis & Distributor Pricing</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {!processing.isProcessing && data.length > 0 && (
               <button 
                onClick={startProcessing}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Analysis
              </button>
            )}
            
            {processing.isProcessing && (
              <button 
                onClick={stopProcessing}
                disabled={isStopping}
                className={`flex items-center gap-2 ${isStopping ? 'bg-slate-300' : 'bg-red-500 hover:bg-red-600'} text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md active:scale-95`}
              >
                <Square className="w-4 h-4 fill-current" />
                {isStopping ? 'Stopping...' : 'Stop'}
              </button>
            )}

            {enrichedData.length > 0 && (
              <button 
                onClick={handleExport}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md active:scale-95"
              >
                <Download className="w-4 h-4" />
                Export Results
              </button>
            )}

            {(data.length > 0 || enrichedData.length > 0) && (
              <button
                onClick={handleReset}
                disabled={processing.isProcessing}
                className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-full font-medium transition-all shadow-sm active:scale-95"
                title="Reset Application"
              >
                <RefreshCcw className="w-4 h-4" />
                Reset
              </button>
            )}
          </div>
        </header>

        {!processing.isProcessing && data.length === 0 && enrichedData.length === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <label className="group relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-2xl bg-white hover:border-indigo-400 hover:bg-slate-50 transition-all cursor-pointer overflow-hidden">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 text-slate-400 group-hover:text-indigo-500 mb-4 transition-colors" />
                  <p className="mb-2 text-sm text-slate-700">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-500">Excel (XLSX, XLS) or CSV</p>
                </div>
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
                {data.length > 0 && (
                  <div className="absolute inset-0 bg-white/90 flex items-center justify-center p-6 animate-in fade-in zoom-in duration-300">
                    <div className="text-center">
                      <FileText className="w-12 h-12 text-indigo-600 mx-auto mb-2" />
                      <p className="font-medium text-slate-900">{fileName}</p>
                      <p className="text-sm text-slate-500">{data.length} rows loaded</p>
                      <button 
                        onClick={(e) => { e.preventDefault(); setData([]); setEnrichedData([]); }}
                        className="mt-4 text-xs text-red-500 font-semibold uppercase tracking-wider hover:underline"
                      >
                        Change File
                      </button>
                    </div>
                  </div>
                )}
              </label>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-slate-50 px-2 text-sm text-slate-500">or enter manually</span>
                </div>
              </div>

              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={manualMpn}
                  onChange={(e) => setManualMpn(e.target.value)}
                  placeholder="Enter a single MPN (e.g. STM32F103C8T6)"
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={!manualMpn.trim()}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm"
                >
                  Load MPN
                </button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-600" />
                Column Mapping
              </h3>
              
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">MPN Column</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none"
                    value={mpnColumn}
                    onChange={(e) => setMpnColumn(e.target.value)}
                  >
                    <option value="">Select Column...</option>
                    {data.length > 0 && Object.keys(data[0]).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Manufacturer</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none"
                    value={mfrColumn}
                    onChange={(e) => setMfrColumn(e.target.value)}
                  >
                    <option value="">None</option>
                    {data.length > 0 && Object.keys(data[0]).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Quantity</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none"
                    value={qtyColumn}
                    onChange={(e) => setQtyColumn(e.target.value)}
                  >
                    <option value="">Default to 1</option>
                    {data.length > 0 && Object.keys(data[0]).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {(processing.isProcessing || enrichedData.length > 0) && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            <div className="xl:col-span-1 space-y-4">
              <div className="bg-slate-900 rounded-2xl p-5 text-slate-300 shadow-xl h-[600px] flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    Process Logs
                  </h3>
                  {processing.isProcessing && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 text-[11px] font-mono">
                  {processing.logs.map((log, i) => (
                    <div key={i} className={`pb-1 border-b border-slate-800/50 ${log.includes('✓') ? 'text-emerald-400' : log.includes('⚠') ? 'text-amber-400' : 'text-slate-400'}`}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>

              {processing.isProcessing && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                  <div className="flex justify-between items-end mb-2">
                    <p className="text-sm font-bold text-slate-800">Progress</p>
                    <p className="text-xs font-medium text-slate-500">{processing.current} / {processing.total}</p>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-600 transition-all duration-500 rounded-full"
                      style={{ width: `${(processing.current / processing.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="xl:col-span-3 space-y-6">
              {enrichedData.length > 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1200px]">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-200">
                        <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Part Info</th>
                        <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Best Price</th>
                        <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Distributors</th>
                        <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supply Chain</th>
                        <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Technical</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {enrichedData.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-4 py-4 align-top max-w-[200px]">
                            <p className="font-bold text-slate-900 mb-0.5 break-words">{item.mpn || 'Unknown'}</p>
                            <p className="text-xs font-medium text-slate-500">{item.manufacturer || 'Unknown'}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                (item.status || '').toLowerCase().includes('active') ? 'bg-emerald-100 text-emerald-700' : 
                                (item.status || '').toLowerCase().includes('obsolete') ? 'bg-red-100 text-red-700' : 
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {item.status || 'Unknown'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <p className="text-lg font-black text-indigo-700 mb-0.5">{item.unitPrice || 'N/A'}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">MOQ: {item.moq || 'N/A'}</p>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-[11px]">
                              <div className="flex justify-between border-b border-slate-50">
                                <span className="text-slate-400">TTI</span>
                                <span className="font-bold">{item.ttiPrice || 'N/A'}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50">
                                <span className="text-slate-400">Future</span>
                                <span className="font-bold">{item.futurePrice || 'N/A'}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50">
                                <span className="text-slate-400">DigiKey</span>
                                <span className="font-bold">{item.digikeyPrice || 'N/A'}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50">
                                <span className="text-slate-400">Mouser</span>
                                <span className="font-bold">{item.mouserPrice || 'N/A'}</span>
                              </div>
                              <div className="flex justify-between border-b border-slate-50">
                                <span className="text-slate-400">Arrow</span>
                                <span className="font-bold">{item.arrowPrice || 'N/A'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span>Lead: <span className="font-bold">{item.leadTime || 'N/A'}</span></span>
                              </div>
                              <div className="pt-2">
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Stock Sources</p>
                                <div className="flex flex-wrap gap-1">
                                  {(item.sources || []).slice(0, 3).map((src, i) => (
                                    <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="bg-slate-100 hover:bg-indigo-100 text-slate-600 p-1 rounded">
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{item.description || 'N/A'}</p>
                            <p className="text-[10px] font-bold text-indigo-500 uppercase mt-2">{item.technology}</p>
                            {item.validationNote && (
                              <div className="mt-2 p-1.5 bg-amber-50 rounded border border-amber-100 flex gap-1.5 items-start">
                                <Info className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-[9px] text-amber-700 leading-tight">{item.validationNote}</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-white rounded-2xl h-[400px] flex flex-col items-center justify-center text-center p-8 border border-slate-200 border-dashed">
                  <div className="bg-indigo-50 p-4 rounded-full mb-4">
                    <SearchX className="w-12 h-12 text-indigo-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">No data analyzed yet</h3>
                  <p className="text-slate-500 max-w-sm mt-2">
                    Upload your BOM and click "Start Analysis" to begin searching for pricing and technical details.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
