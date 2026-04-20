import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type LooseProfile = {
  email?: string;
  role?: string;
  centerName?: string;
  center_name?: string;
  centers?: {
    name?: string;
  } | null;
};

const navItems = [
  { to: '/dashboard', label: 'ダッシュボード' },
  { to: '/progress', label: '工程進捗' },
  { to: '/assignments', label: '人員配置' },
  { to: '/alerts', label: 'アラート' },
  { to: '/imports', label: 'CSV取込' },
];

export default function AppLayout() {
  const auth = useAuth() as any;
  const profile = (auth?.profile ?? null) as LooseProfile | null;
  const user = auth?.user ?? null;
  const navigate = useNavigate();

  const centerName =
    profile?.centerName ??
    profile?.center_name ??
    profile?.centers?.name ??
    'センター未設定';

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-100">
      <div className="flex h-full min-w-0">
        <aside className="w-72 min-w-[288px] shrink-0 overflow-y-auto bg-[#071a36] text-white">
          <div className="border-b border-white/10 px-6 py-7">
            <div className="text-xs tracking-[0.28em] text-cyan-200">PHYZ OPS VISION</div>
            <div className="mt-3 text-[18px] font-bold leading-tight">
              物流センター運営基盤
            </div>
          </div>

          <nav className="space-y-2 px-4 py-6">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-4 text-base font-semibold transition ${
                    isActive
                      ? 'bg-emerald-500 text-white shadow-lg'
                      : 'text-white/90 hover:bg-white/10'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 px-8 py-5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-slate-900">Phyz Ops Vision</div>
                <div className="mt-1 text-sm text-slate-500">
                  {centerName} / {profile?.email ?? user?.email ?? '-'}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
                  権限: {profile?.role ?? '-'}
                </span>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  ログアウト
                </button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
            <div className="min-w-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}