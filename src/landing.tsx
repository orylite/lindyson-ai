import { MotionConfig } from 'motion/react';
import { useEffect,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './app/components/LandingPage';
import type { AdminPlan } from './app/data/admin';
import { trackVisit } from './app/state/attribution';
import './styles/landing.css';

/**
 * 首页独立入口：只加载落地页和公开套餐，不加载工作台控制器、后台和用户端样式。
 * 登录与工作台走 app.html，整页跳转后由 main.tsx 接管。
 */
function goToLogin() {
  // 保留查询参数：邀约码 ?ref= 与推广参数 utm_* 要跟着进入登录/注册页。
  window.location.assign(`/login${window.location.search}`);
}

function LandingRoot() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);

  useEffect(() => {
    // 到站即上报访客来源（同一访客同一天同一来源一次），并记录注册归因。
    trackVisit();
  }, []);

  useEffect(() => {
    let active = true;
    // 定价区在首屏之下，接口层和契约校验按需加载，不阻塞首屏。
    import('./app/api/queries')
      .then(queries => queries.getPublicPlans())
      .then(items => { if (active) setPlans(items); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="dark min-h-screen overflow-hidden bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1e] to-[#1a0a2e] text-foreground">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] animate-pulse delay-700"></div>
          <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-pink-500/10 rounded-full blur-[120px] animate-pulse delay-1000"></div>
        </div>
        <LandingPage plans={plans} onStart={goToLogin} onLogin={goToLogin} />
      </div>
    </MotionConfig>
  );
}

createRoot(document.getElementById('root')!).render(<LandingRoot />);
