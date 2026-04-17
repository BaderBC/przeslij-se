import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSize } from '../utils/format.js';

const CHUNK_SIZE = 65536; // 64 KB

export default function SenderView({ prefilledCode = '', onBack }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(prefilledCode.toUpperCase());
  const [file, setFile] = useState(null);
  const [viewState, setViewState] = useState('idle'); // idle | connecting | ready | waiting | sending | done | rejected | error
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [showScanner, setShowScanner] = useState(true);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const fileRef = useRef(null);
  const viewStateRef = useRef('idle');
  const fileInputRef = useRef(null);

  const updateState = (s) => {
    viewStateRef.current = s;
    setViewState(s);
  };

  useEffect(() => {
    if (prefilledCode) connect(prefilledCode.toUpperCase());
    return () => peerRef.current?.destroy();
  }, []); // eslint-disable-line

  const getOrCreatePeer = async () => {
    if (peerRef.current) return peerRef.current;
    const { Peer } = await import('peerjs');
    const peer = new Peer();
    peerRef.current = peer;
    await new Promise((resolve, reject) => {
      peer.on('open', resolve);
      peer.on('error', reject);
    });
    return peer;
  };

  const connect = async (targetCode) => {
    if (!targetCode || targetCode.length !== 6) return;
    updateState('connecting');

    const timer = setTimeout(() => {
      if (viewStateRef.current === 'connecting') updateState('error');
    }, 12000);

    try {
      const peer = await getOrCreatePeer();
      const conn = peer.connect(targetCode, { reliable: true });
      connRef.current = conn;

      conn.on('open', () => {
        clearTimeout(timer);
        updateState('ready');
      });

      conn.on('data', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'accept') sendChunks(conn);
        else if (msg.type === 'reject') updateState('rejected');
      });

      conn.on('error', () => { clearTimeout(timer); updateState('error'); });
      conn.on('close', () => {
        clearTimeout(timer);
        if (viewStateRef.current !== 'done' && viewStateRef.current !== 'rejected') {
          updateState('error');
        }
      });
    } catch {
      clearTimeout(timer);
      updateState('error');
    }
  };

  const handleCodeChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(val);
    if (val.length === 6 && (viewStateRef.current === 'idle' || viewStateRef.current === 'error')) {
      connRef.current?.close();
      connect(val);
    }
  };

  const handleFile = (f) => {
    setFile(f);
    fileRef.current = f;
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleScan = (scannedCode) => {
    setCode(scannedCode);
    setShowScanner(false);
    connect(scannedCode);
  };

  const sendOffer = () => {
    if (!file || !connRef.current) return;
    fileRef.current = file;
    connRef.current.send(
      JSON.stringify({
        type: 'offer',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      })
    );
    updateState('waiting');
  };

  const sendChunks = (conn) => {
    const f = fileRef.current;
    if (!f) return;
    updateState('sending');
    let offset = 0;

    const next = () => {
      if (offset >= f.size) {
        conn.send(JSON.stringify({ type: 'done' }));
        updateState('done');
        return;
      }
      const slice = f.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = (e) => {
        conn.send(e.target.result);
        offset += CHUNK_SIZE;
        setProgress(Math.min(100, Math.round((offset / f.size) * 100)));
        next();
      };
      reader.readAsArrayBuffer(slice);
    };

    next();
  };

  const handleFullReset = () => {
    peerRef.current?.destroy();
    peerRef.current = null;
    connRef.current = null;
    fileRef.current = null;
    setCode('');
    setFile(null);
    setProgress(0);
    updateState('idle');
  };

  // Terminal states
  if (viewState === 'done') {
    return (
      <div className="text-center space-y-5 max-w-xs w-full">
        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
          <CheckIcon className="w-8 h-8 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{t('sender.done')}</h2>
          {file && <p className="text-slate-400 text-sm mt-1 break-all">{file.name}</p>}
        </div>
        <button onClick={handleFullReset} className="btn-secondary w-full">
          {t('sender.sendAnother')}
        </button>
      </div>
    );
  }

  if (viewState === 'rejected') {
    return (
      <div className="text-center space-y-5 max-w-xs w-full">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <XIcon className="w-8 h-8 text-red-400" />
        </div>
        <p className="text-slate-500 text-sm">{t('sender.rejected')}</p>
        <button onClick={handleFullReset} className="btn-secondary w-full">
          {t('sender.sendAnother')}
        </button>
      </div>
    );
  }

  if (viewState === 'sending') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 max-w-xs w-full space-y-4 text-center">
        <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto">
          <UploadIcon className="w-6 h-6 text-indigo-500" />
        </div>
        <div>
          <p className="font-medium text-slate-700">{t('sender.sending')}</p>
          {file && <p className="text-slate-400 text-sm mt-1 break-all">{file.name}</p>}
        </div>
        <ProgressBar value={progress} />
        <p className="text-slate-400 text-sm">{progress}%</p>
      </div>
    );
  }

  // Main form: file first, then code
  const isConnected = viewState === 'ready' || viewState === 'waiting';
  const isConnecting = viewState === 'connecting';
  const hasError = viewState === 'error';
  const canSend = file && isConnected && viewState !== 'waiting';

  return (
    <div className="w-full max-w-xs space-y-4">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {t('app.backToReceive')}
      </button>

      <h1 className="text-xl font-semibold text-slate-800">{t('sender.headline')}</h1>

      {/* Step 1: File */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !file && fileInputRef.current?.click()}
        className={`bg-white border-2 border-dashed rounded-2xl p-7 text-center transition-all ${
          dragOver
            ? 'border-indigo-400 bg-indigo-50 cursor-copy'
            : file
            ? 'border-slate-200 cursor-default'
            : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {file ? (
          <div className="space-y-1.5">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto">
              <FileIcon className="w-5 h-5 text-indigo-500" />
            </div>
            <p className="font-medium text-slate-800 break-all text-sm">{file.name}</p>
            <p className="text-slate-400 text-xs">{formatSize(file.size)}</p>
            <button
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors mt-1"
            >
              {t('sender.changeFile')}
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <UploadIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-600 text-sm">{t('sender.dropFile')}</p>
            <p className="text-slate-400 text-xs">{t('sender.orClick')}</p>
          </div>
        )}
      </div>

      {/* Step 2: Code — only after file is chosen */}
      {file && (
        <div className="space-y-2">
          <label className="text-sm text-slate-500">{t('sender.enterCode')}</label>
          <div className="relative">
            <input
              value={code}
              onChange={handleCodeChange}
              placeholder={t('sender.codePlaceholder')}
              maxLength={6}
              className={`w-full bg-white text-center text-2xl font-mono tracking-[0.3em] py-3 px-4 rounded-xl border-2 outline-none transition-colors ${
                hasError
                  ? 'border-red-300 focus:border-red-400'
                  : isConnected
                  ? 'border-emerald-300'
                  : 'border-slate-200 focus:border-indigo-400'
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isConnecting && <SmallSpinner />}
              {isConnected && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {t('sender.connected')}
                </span>
              )}
            </div>
          </div>

          {hasError && (
            <p className="text-red-500 text-xs">{t('sender.codeError')}</p>
          )}

          <button
            onClick={() => setShowScanner((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            {t('sender.scanQR')}
          </button>

          {showScanner && <QRScanner onScan={handleScan} label={t('sender.scannerLabel')} />}
        </div>
      )}

      {/* Send button — only after file is chosen */}
      {file && <button
        onClick={sendOffer}
        disabled={!canSend}
        className="btn-primary w-full"
      >
        {viewState === 'waiting' ? t('sender.waitingAccept') : t('sender.send')}
      </button>}
    </div>
  );
}

function QRScanner({ onScan, label }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!mounted) return;
      const scanner = new Html5Qrcode('qr-scanner-el');
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (text) => {
            scanner.stop().then(() => {
              try {
                const url = new URL(text);
                const c = url.searchParams.get('to');
                if (c) { onScan(c.toUpperCase()); return; }
              } catch { /* plain text */ }
              if (/^[A-Z2-9]{6}$/i.test(text)) onScan(text.toUpperCase());
            });
          },
          () => {}
        )
        .catch(() => {});
    });
    return () => {
      mounted = false;
      try { scannerRef.current?.stop().catch(() => {}); } catch { /* not started yet */ }
    };
  }, [onScan]);

  return (
    <div className="rounded-xl overflow-hidden bg-black mt-1">
      <p className="text-xs text-slate-400 p-2 text-center bg-white border-b border-slate-100">{label}</p>
      <div id="qr-scanner-el" />
    </div>
  );
}

function SmallSpinner() {
  return (
    <div className="w-4 h-4 border border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
  );
}

function ProgressBar({ value }) {
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5">
      <div
        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function CheckIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function XIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function FileIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function UploadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}
