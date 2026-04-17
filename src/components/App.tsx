import '../i18n/index';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReceiverView from './ReceiverView';
import SenderView from './SenderView';

type Mode = 'receive' | 'send';

export default function App() {
  const { i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>('receive');
  const [prefilledCode, setPrefilledCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const to = params.get('to');
    if (to) {
      setPrefilledCode(to.toUpperCase());
      setMode('send');
    }
  }, []);

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language.startsWith('pl') ? 'en' : 'pl');
  };

  const goToSend = () => {
    setPrefilledCode('');
    setMode('send');
  };

  const goToReceive = () => {
    setPrefilledCode('');
    setMode('receive');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
        <button
          onClick={goToReceive}
          className="font-semibold text-slate-800 hover:text-slate-500 transition-colors"
        >
          prześlij.se
        </button>
        <button
          onClick={toggleLang}
          className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-2.5 py-1 rounded-lg transition-colors"
        >
          {i18n.language.startsWith('pl') ? 'EN' : 'PL'}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 py-10">
        {mode === 'receive' ? (
          <ReceiverView onSendInstead={goToSend} />
        ) : (
          <SenderView prefilledCode={prefilledCode} onBack={goToReceive} />
        )}
      </main>
    </div>
  );
}
