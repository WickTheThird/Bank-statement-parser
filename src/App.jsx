import { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { parsePDF } from './utils/pdfParser';
import { parseCSV } from './utils/csvParser';
import { exportToExcel, exportMultipleStatements } from './utils/excelExport';
import { extractRawPDFData } from './utils/pdfDebug';

import TestPage from './TestPage';

function App() {
  // Simple routing
  if (window.location.pathname === '/test') {
    return <TestPage />;
  }

  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [globalError, setGlobalError] = useState('');
  const [mergeExports, setMergeExports] = useState(true);

  const parsedFiles = useMemo(
    () => files.filter(file => file.transactions.length > 0),
    [files],
  );

  const selectedFile = useMemo(() => {
    if (files.length === 0) return null;
    const explicit = files.find(file => file.id === selectedFileId);
    return explicit || files[0];
  }, [files, selectedFileId]);

  const selectedTransactions = selectedFile?.transactions || [];

  const stats = selectedTransactions.length > 0 ? {
    total: selectedTransactions.length,
    income: selectedTransactions
      .filter(t => parseFloat(t.credit || 0) > 0)
      .reduce((sum, t) => sum + parseFloat(t.credit), 0),
    expenses: selectedTransactions
      .filter(t => parseFloat(t.debit || 0) > 0)
      .reduce((sum, t) => sum + parseFloat(t.debit), 0),
  } : null;

  const netAmount = stats ? stats.income - stats.expenses : 0;

  const createFileEntry = useCallback((file) => ({
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    transactions: [],
    bankType: '',
    loading: false,
    error: '',
    progress: '',
    rawData: null,
    debugMode: false,
  }), []);

  const updateFile = (fileId, updates) => {
    setFiles(prev => prev.map(file =>
      file.id === fileId
        ? (typeof updates === 'function' ? updates(file) : { ...file, ...updates })
        : file,
    ));
  };

  const onDrop = useCallback((acceptedFiles) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;

    const entries = [];

    for (const uploadedFile of acceptedFiles) {
      if (uploadedFile.size > 10 * 1024 * 1024) {
        setGlobalError('File size exceeds 10MB limit');
        continue;
      }

      const fileType = uploadedFile.type;
      const fileName = uploadedFile.name.toLowerCase();

      if (
        fileType !== 'application/pdf' &&
        fileType !== 'text/csv' &&
        !fileName.endsWith('.pdf') &&
        !fileName.endsWith('.csv')
      ) {
        setGlobalError('Please upload a PDF or CSV file');
        continue;
      }

      entries.push(createFileEntry(uploadedFile));
    }

    if (entries.length === 0) return;

    setFiles(prev => {
      const deduped = entries.filter(entry =>
        !prev.some(p => p.file.name === entry.file.name && p.file.lastModified === entry.file.lastModified),
      );
      return [...prev, ...deduped];
    });

    setSelectedFileId(prev => prev || entries[0]?.id || null);
    setGlobalError('');
  }, [createFileEntry]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/csv': ['.csv'],
    },
    maxFiles: 10,
    multiple: true,
  });

  const handleParseFile = async (fileId) => {
    const target = files.find(file => file.id === fileId);
    if (!target) return;

    updateFile(fileId, {
      loading: true,
      error: '',
      progress: 'Starting...',
      debugMode: false,
      rawData: null,
    });

    const progressCallback = (message) => updateFile(fileId, { progress: message });

    try {
      const result = target.file.name.toLowerCase().endsWith('.pdf')
        ? await parsePDF(target.file, progressCallback)
        : await parseCSV(target.file, progressCallback);

      updateFile(fileId, {
        transactions: result.transactions,
        bankType: result.bankType,
        loading: false,
        progress: '',
        error: '',
      });

      setSelectedFileId(prev => prev || fileId);
    } catch (err) {
      updateFile(fileId, {
        error: err.message || 'Failed to parse file',
        loading: false,
        progress: '',
      });
    }
  };

  const handleParseAll = async () => {
    for (const file of files) {
      await handleParseFile(file.id);
    }
  };

  const handleDebug = async (fileId) => {
    const target = files.find(file => file.id === fileId);
    if (!target) return;

    if (!target.file.name.toLowerCase().endsWith('.pdf')) {
      updateFile(fileId, { error: 'Debug mode only works with PDF files' });
      return;
    }

    updateFile(fileId, {
      loading: true,
      error: '',
      progress: 'Extracting raw PDF data...',
      debugMode: false,
      rawData: null,
    });

    try {
      const data = await extractRawPDFData(target.file);
      updateFile(fileId, {
        rawData: data,
        debugMode: true,
        loading: false,
        progress: '',
      });
      setSelectedFileId(fileId);
    } catch (err) {
      updateFile(fileId, {
        error: err.message || 'Failed to extract PDF data',
        loading: false,
        progress: '',
      });
    }
  };

  const handleClearDebug = () => {
    if (!selectedFile) return;
    updateFile(selectedFile.id, { debugMode: false, rawData: null });
  };

  const handleExportFile = (fileId) => {
    const target = files.find(file => file.id === fileId);
    if (!target || target.transactions.length === 0) return;

    const nameWithoutExt = target.file.name.replace(/\.[^/.]+$/, '');
    const bankSuffix = target.bankType ? `-${target.bankType.replace(/\s+/g, '-')}` : '';
    const filename = `${nameWithoutExt}${bankSuffix}-${new Date().toISOString().split('T')[0]}.xlsx`;

    exportToExcel(target.transactions, filename);
  };

  const handleExportAll = () => {
    if (parsedFiles.length === 0) {
      setGlobalError('Parse at least one statement before exporting');
      return;
    }

    const dateSuffix = new Date().toISOString().split('T')[0];

    exportMultipleStatements(
      parsedFiles.map(file => ({
        transactions: file.transactions,
        label: `${file.file.name.replace(/\.[^/.]+$/, '')}${file.bankType ? `-${file.bankType}` : ''}`,
      })),
      `bank-statements-${dateSuffix}.xlsx`,
      { singleSheet: mergeExports },
    );
  };

  const handleReset = () => {
    setFiles([]);
    setSelectedFileId(null);
    setGlobalError('');
  };

  const handleRemoveFile = (fileId) => {
    setFiles(prev => prev.filter(file => file.id !== fileId));
    setSelectedFileId(prev => (prev === fileId ? null : prev));
  };

  const hasParsedTransactions = parsedFiles.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-6">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Bank Statement Parser
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Convert PDF and CSV bank statements to Excel spreadsheets
          </p>
        </div>

        <div className="space-y-12">
          {/* Upload Area */}
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-3xl p-16 text-center cursor-pointer transition-all
              ${isDragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
              }
            `}
          >
            <input {...getInputProps()} />

            <div className="flex justify-center mb-6">
              <div className={`p-6 rounded-full ${isDragActive ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <svg
                  className={`w-16 h-16 ${isDragActive ? 'text-blue-600' : 'text-gray-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
            </div>

            {isDragActive ? (
              <div>
                <p className="text-2xl font-semibold text-blue-600 mb-2">Drop your files here</p>
                <p className="text-gray-500">Release to upload</p>
              </div>
            ) : (
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                  Drop one or many bank statements here
                </h3>
                <p className="text-lg text-gray-600 mb-2">or click to browse</p>
                <p className="text-sm text-gray-500">
                  PDF or CSV • Maximum 10MB each • You can upload multiple files at once
                </p>
              </div>
            )}
          </div>

          {/* Global Error */}
          {globalError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-red-900 text-lg mb-1">Error</h3>
                  <p className="text-red-700">{globalError}</p>
                </div>
              </div>
            </div>
          )}

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-4">
              {files.map(file => {
                const isSelected = selectedFile?.id === file.id;
                const hasData = file.transactions.length > 0;
                return (
                  <div
                    key={file.id}
                    className={`bg-white rounded-2xl p-6 border ${isSelected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'}`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-lg font-semibold text-gray-900 truncate">{file.file.name}</p>
                            {hasData && (
                              <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">
                                {file.bankType || 'Parsed'} • {file.transactions.length} txns
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">
                            {(file.file.size / 1024).toFixed(2)} KB
                          </p>
                          {file.progress && (
                            <p className="text-sm text-blue-600 mt-1">{file.progress}</p>
                          )}
                          {file.error && (
                            <p className="text-sm text-red-600 mt-1">{file.error}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => setSelectedFileId(file.id)}
                          className={`px-4 py-2 rounded-lg border text-sm font-semibold ${isSelected ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-600'}`}
                        >
                          {isSelected ? 'Selected' : 'Preview'}
                        </button>
                        <button
                          onClick={() => handleParseFile(file.id)}
                          disabled={file.loading}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold"
                        >
                          {file.loading ? (file.progress || 'Processing...') : hasData ? 'Re-parse' : 'Parse'}
                        </button>
                        {file.file.name.toLowerCase().endsWith('.pdf') && (
                          <button
                            onClick={() => handleDebug(file.id)}
                            disabled={file.loading}
                            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 text-white text-sm font-semibold"
                          >
                            Debug
                          </button>
                        )}
                        <button
                          onClick={() => handleExportFile(file.id)}
                          disabled={!hasData}
                          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-semibold"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => handleRemoveFile(file.id)}
                          className="px-3 py-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700"
                          title="Remove file"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-3 items-center justify-end pt-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergeExports}
                    onChange={(e) => setMergeExports(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  Merge all into single sheet
                </label>
                <button
                  onClick={handleReset}
                  className="px-4 py-3 bg-white hover:bg-gray-50 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl transition-colors text-sm"
                >
                  Clear All
                </button>
                <button
                  onClick={handleParseAll}
                  disabled={files.length === 0}
                  className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Parse All
                </button>
                <button
                  onClick={handleExportAll}
                  disabled={parsedFiles.length === 0}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Export All to Excel
                </button>
              </div>
            </div>
          )}

          {/* Debug View */}
          {selectedFile?.debugMode && selectedFile.rawData && (
            <div className="bg-white rounded-2xl p-8 border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Debug View - Raw PDF Data</h2>
                <button
                  onClick={handleClearDebug}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-blue-900 mb-2">Detected Column X Positions:</p>
                <div className="flex gap-4 flex-wrap">
                  {selectedFile.rawData.columnXRanges.map((x, idx) => (
                    <span key={idx} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-md font-mono text-sm">
                      Column {idx + 1}: X={x}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  These X-coordinates represent where numbers (amounts) appear in the PDF. The parser uses these to identify Debit, Credit, and Balance columns.
                </p>
              </div>

              <div className="space-y-6 max-h-[600px] overflow-y-auto">
                {selectedFile.rawData.pages.map((page) => (
                  <div key={page.pageNum} className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Page {page.pageNum}</h3>
                    <div className="space-y-2 font-mono text-xs">
                      {page.rows.map((row, rowIdx) => (
                        <div key={rowIdx} className="border-b border-gray-100 pb-2">
                          <div className="flex items-start gap-2 mb-1">
                            <span className="text-gray-400 text-[10px] w-12">Y:{row.y}</span>
                            <div className="flex-1">
                              {row.items.map((item, itemIdx) => {
                                const isNumber = /[\d,]+\.\d{2}/.test(item.text);
                                return (
                                  <span
                                    key={itemIdx}
                                    className={`inline-block mr-2 px-1 ${isNumber ? 'bg-yellow-100 text-yellow-900 font-semibold' : 'text-gray-700'}`}
                                    title={`X: ${item.x}`}
                                  >
                                    {item.text}
                                    <span className="text-[8px] text-gray-400 ml-1">({item.x})</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          <div className="text-[10px] text-gray-500 ml-14">
                            Full text: {row.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parsed Preview or Features */}
          {hasParsedTransactions ? (
            <div className="space-y-8">
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Previewing</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {selectedFile?.file.name || 'Select a file'}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => selectedFile && handleExportFile(selectedFile.id)}
                    disabled={!selectedFile || selectedTransactions.length === 0}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-sm"
                  >
                    Export Selected to Excel
                  </button>
                  <button
                    onClick={handleExportAll}
                    disabled={parsedFiles.length === 0}
                    className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-sm"
                  >
                    Export All
                  </button>
                </div>
              </div>

              {selectedTransactions.length === 0 && (
                <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center text-gray-600">
                  <p className="text-lg font-semibold text-gray-900 mb-2">No preview yet</p>
                  <p className="mb-4">Select a parsed statement from above or parse the selected file to view its transactions.</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => selectedFile && handleParseFile(selectedFile.id)}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold"
                    >
                      Parse Selected File
                    </button>
                  </div>
                </div>
              )}

              {selectedTransactions.length > 0 && (
                <>
                  {/* Stats Cards */}
                  <div className="grid md:grid-cols-4 gap-6">
                    <div className="bg-white rounded-2xl p-6 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-gray-600">Bank</p>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{selectedFile?.bankType || 'Unknown'}</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                          <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-gray-600">Transactions</p>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-gray-600">Income</p>
                      </div>
                      <p className="text-2xl font-bold text-green-600">€{stats.income.toFixed(2)}</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-gray-600">Expenses</p>
                      </div>
                      <p className="text-2xl font-bold text-red-600">€{stats.expenses.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Transactions Table */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Date</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Description</th>
                            <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Debit</th>
                            <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Credit</th>
                            <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {selectedTransactions.slice(0, 100).map((txn, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm text-gray-900 whitespace-nowrap">{txn.date}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{txn.details}</td>
                              <td className="px-6 py-4 text-sm text-red-600 text-right whitespace-nowrap">
                                {txn.debit ? `€${parseFloat(txn.debit).toFixed(2)}` : ''}
                              </td>
                              <td className="px-6 py-4 text-sm text-green-600 text-right whitespace-nowrap">
                                {txn.credit ? `€${parseFloat(txn.credit).toFixed(2)}` : ''}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 text-right font-medium whitespace-nowrap">
                                {txn.balance ? `€${parseFloat(txn.balance).toFixed(2)}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {selectedTransactions.length > 100 && (
                      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-600">
                        Showing first 100 of {selectedTransactions.length} transactions. Export to view all.
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-4 justify-center">
                    <button
                      onClick={handleReset}
                      className="px-8 py-4 bg-white hover:bg-gray-50 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl transition-colors text-lg"
                    >
                      Start Over
                    </button>
                    <button
                      onClick={() => selectedFile && handleExportFile(selectedFile.id)}
                      disabled={selectedTransactions.length === 0}
                      className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors flex items-center gap-3 text-lg disabled:bg-gray-300"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export to Excel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="max-w-7xl mx-auto space-y-12">
              {/* Features Grid */}
              <div className="grid md:grid-cols-3 gap-8 pt-8">
                <div className="text-center">
                  <div className="inline-flex w-14 h-14 items-center justify-center bg-blue-100 rounded-2xl mb-4">
                    <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Multi-Format</h3>
                  <p className="text-gray-600">
                    Supports PDF and CSV files with automatic format detection
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex w-14 h-14 items-center justify-center bg-green-100 rounded-2xl mb-4">
                    <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">100% Private</h3>
                  <p className="text-gray-600">
                    All processing happens in your browser. No data leaves your device
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex w-14 h-14 items-center justify-center bg-purple-100 rounded-2xl mb-4">
                    <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Smart Export</h3>
                  <p className="text-gray-600">
                    Sorted, de-duplicated, and formatted Excel files ready for analysis
                  </p>
                </div>
              </div>

              {/* Supported Banks */}
              <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl p-10 border border-gray-200">
                <p className="text-sm uppercase tracking-wider text-gray-500 text-center mb-8 font-semibold">
                  Supported Banks
                </p>
                <div className="flex justify-center items-center gap-16">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl font-bold text-blue-600">AIB</span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Allied Irish Banks</p>
                  </div>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl font-bold text-green-600">BOI</span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Bank of Ireland</p>
                  </div>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl font-bold text-purple-600">R</span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Revolut</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-gray-200 text-center text-sm text-gray-500">
          <p>Supports AIB, Bank of Ireland, and Revolut • All processing is done locally in your browser</p>
        </footer>

      </div>
    </div>
  );
}

export default App;
