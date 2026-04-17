import { useState, useEffect, useRef, useCallback } from 'react';
import type { Peer as PeerInstance, DataConnection } from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { generateCode, formatSize } from '../utils/format';

const CHUNK_SIZE = 65536; // 64 KB

type ViewState = 'waiting' | 'pending' | 'receiving' | 'done';

interface OfferMessage {
  type: 'offer';
  name: string;
  size: number;
  mimeType: string;
}

interface DoneMessage {
  type: 'done';
}

type IncomingMessage = OfferMessage | DoneMessage;

interface ReceiverViewProps {
  onSendInstead: () => void;
}

interface IconProps {
  className?: string;
}

export default function ReceiverView({ onSendInstead }: ReceiverViewProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [peerReady, setPeerReady] = useState(false);
  const [peerError, setPeerError] = useState(false);
  const [viewState, setViewState] = useState<ViewState>('waiting'); // waiting | pending | receiving | done
  const [offer, setOffer] = useState<OfferMessage | null>(null);
  const [progress, setProgress] = useState(0);

  const peerRef = useRef<PeerInstance | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const offerRef = useRef<OfferMessage | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const receivedRef = useRef(0);

  const initPeer = useCallback(async (peerCode: string) => {
    const { Peer } = await import('peerjs');
    const peer = new Peer(peerCode);
    peerRef.current = peer;

    peer.on('open', () => setPeerReady(true));

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        const fresh = generateCode();
        setCode(fresh);
        initPeer(fresh);
      } else {
        setPeerError(true);
      }
    });

    peer.on('connection', (conn: DataConnection) => {
      connRef.current = conn;
      conn.on('data', (data: unknown) => {
        if (typeof data === 'string') {
          const msg = JSON.parse(data) as IncomingMessage;
          if (msg.type === 'offer') {
            offerRef.current = msg;
            setOffer(msg);
            setViewState('pending');
          } else if (msg.type === 'done') {
            const meta = offerRef.current;
            const blob = new Blob(chunksRef.current, {
              type: meta?.mimeType || 'application/octet-stream',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = meta?.name ?? 'file';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            setViewState('done');
          }
        } else {
          // PeerJS may deliver binary data as ArrayBuffer, Uint8Array, Buffer, or Blob
          // depending on the browser and serialization. Normalise to ArrayBuffer.
          let buf: ArrayBuffer | undefined;
          if (data instanceof ArrayBuffer) {
            buf = data;
          } else if (ArrayBuffer.isView(data)) {
            buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          } else if (data instanceof Blob) {
            data.arrayBuffer().then((ab) => {
              chunksRef.current.push(ab);
              receivedRef.current += ab.byteLength;
              const meta = offerRef.current;
              if (meta?.size) setProgress(Math.min(100, Math.round((receivedRef.current / meta.size) * 100)));
              setViewState((s) => (s !== 'receiving' ? 'receiving' : s));
            });
            return;
          } else {
            return; // unknown type, ignore
          }
          chunksRef.current.push(buf);
          receivedRef.current += buf.byteLength;
          const meta = offerRef.current;
          if (meta?.size) {
            setProgress(Math.min(100, Math.round((receivedRef.current / meta.size) * 100)));
          }
          setViewState((s) => (s !== 'receiving' ? 'receiving' : s));
        }
      });
    });
  }, []);

  useEffect(() => {
    const fresh = generateCode();
    setCode(fresh);
    initPeer(fresh);
    return () => peerRef.current?.destroy();
  }, [initPeer]);

  const handleAccept = () => {
    chunksRef.current = [];
    receivedRef.current = 0;
    setProgress(0);
    setViewState('receiving');
    connRef.current?.send(JSON.stringify({ type: 'accept' }));
  };

  const handleReject = () => {
    connRef.current?.send(JSON.stringify({ type: 'reject' }));
    connRef.current?.close();
    connRef.current = null;
    offerRef.current = null;
    setOffer(null);
    setViewState('waiting');
  };

  const handleReset = () => {
    chunksRef.current = [];
    receivedRef.current = 0;
    offerRef.current = null;
    setOffer(null);
    setProgress(0);
    setViewState('waiting');
  };

  const qrUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?to=${code}`
      : `https://przeslij.se/?to=${code}`;

  if (peerError) {
    return (
      <div className="text-center space-y-3">
        <p className="text-red-500 text-sm">{t('errors.peerError')}</p>
      </div>
    );
  }

  if (!peerReady) {
    return (
      <div className="text-center space-y-3">
        <Spinner />
        <p className="text-slate-400 text-sm">{t('receiver.initializing')}</p>
      </div>
    );
  }

  if (viewState === 'done') {
    return (
      <div className="text-center space-y-5 max-w-xs w-full">
        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
          <CheckIcon className="w-8 h-8 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{t('receiver.done')}</h2>
          <p className="text-slate-400 text-sm mt-1">{t('receiver.downloadStarted')}</p>
        </div>
        <button onClick={handleReset} className="btn-secondary w-full">
          {t('receiver.receiveAnother')}
        </button>
      </div>
    );
  }

  if (viewState === 'pending' && offer) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 max-w-xs w-full space-y-5">
        <div className="text-center">
          <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <FileIcon className="w-6 h-6 text-indigo-500" />
          </div>
          <p className="text-slate-500 text-sm">{t('receiver.incomingFile')}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="font-medium text-slate-800 break-all">{offer.name}</p>
          <p className="text-slate-400 text-sm mt-1">{formatSize(offer.size)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReject} className="btn-secondary flex-1">
            {t('receiver.reject')}
          </button>
          <button onClick={handleAccept} className="btn-primary flex-1">
            {t('receiver.accept')}
          </button>
        </div>
      </div>
    );
  }

  if (viewState === 'receiving') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 max-w-xs w-full space-y-4 text-center">
        <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto">
          <FileIcon className="w-6 h-6 text-indigo-500" />
        </div>
        <div>
          <p className="font-medium text-slate-700">{t('receiver.receiving')}</p>
          {offer && <p className="text-slate-400 text-sm mt-1 break-all">{offer.name}</p>}
        </div>
        <ProgressBar value={progress} />
        <p className="text-slate-400 text-sm">{progress}%</p>
      </div>
    );
  }

  // Default: waiting state
  return (
    <div className="w-full max-w-xs text-center space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">{t('receiver.headline')}</h1>
        <p className="text-slate-400 text-sm mt-1.5">{t('receiver.hint')}</p>
      </div>

      {code && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 inline-block">
          <QRCodeSVG value={qrUrl} size={180} level="M" />
        </div>
      )}

      <div>
        <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">
          {t('receiver.yourCode')}
        </p>
        <div className="flex gap-2 justify-center">
          {code.split('').map((char, i) => (
            <div
              key={i}
              className="w-11 h-14 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-xl font-bold text-slate-800 shadow-sm"
            >
              {char}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-slate-400 text-sm">{t('receiver.waiting')}</span>
      </div>

      <button
        onClick={onSendInstead}
        className="w-full py-3 px-5 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-slate-600 hover:text-indigo-700 font-medium text-sm transition-all duration-150"
      >
        {t('app.sendInstead')} →
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-7 h-7 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin mx-auto" />
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5">
      <div
        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
