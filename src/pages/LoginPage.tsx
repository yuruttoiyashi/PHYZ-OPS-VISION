import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
    '/dashboard';

  const [mode, setMode] = useState<Mode>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [user, navigate, from]);

  function resetMessages() {
    setErrorMessage('');
    setInfoMessage('');
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    resetMessages();
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    resetMessages();

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage('メールアドレスを入力してください。');
      return;
    }

    if (!password) {
      setErrorMessage('パスワードを入力してください。');
      return;
    }

    if (mode === 'register') {
      if (password.length < 8) {
        setErrorMessage('パスワードは8文字以上で入力してください。');
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage('確認用パスワードが一致しません。');
        return;
      }
    }

    setSubmitting(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        navigate(from, { replace: true });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data.session) {
        setInfoMessage('新規登録が完了しました。ログインしました。');
        navigate('/dashboard', { replace: true });
        return;
      }

      setInfoMessage(
        '新規登録が完了しました。メール確認が必要な設定の場合は、確認後にログインしてください。',
      );
      setMode('login');
      setConfirmPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl shadow-slate-200">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-600">
            Phyz Ops Vision
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">
            {mode === 'login' ? 'ログイン' : '新規登録'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {mode === 'login'
              ? '庫内進捗・人員配置・アラートを一元管理します。'
              : 'メールアドレスでアカウントを作成してアプリを確認できます。'}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            ログイン
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            新規登録
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '8文字以上のパスワード' : 'パスワード'}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
              required
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                パスワード確認
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="もう一度入力してください"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-500"
                required
              />
            </div>
          )}

          {errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}

          {infoMessage && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {infoMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? mode === 'login'
                ? 'ログイン中...'
                : '登録中...'
              : mode === 'login'
                ? 'ログイン'
                : '新規登録'}
          </button>
        </form>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
          {mode === 'login'
            ? '登録済みのメールアドレスとパスワードでログインできます。'
            : '新規登録すると、viewer 権限・川崎センター所属の profile が自動作成される想定です。'}
        </div>
      </div>
    </div>
  );
}