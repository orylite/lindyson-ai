import { ArrowLeft,ArrowRight,Lock,Sparkles } from 'lucide-react';
import { useMemo,useState,type FormEvent } from 'react';
import { toast } from 'sonner';
import { validateRegisterPassword } from '../state/auth';
import { Button,Card,Input } from '../ui';

interface ResetPasswordPageProps {
  onResetPassword: (payload: { token: string; password: string }) => Promise<void>;
  onNavigate: (path: string) => void;
}

export function ResetPasswordPage({ onResetPassword, onNavigate }: ResetPasswordPageProps) {
  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') ?? '';
  }, []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      toast.error('重置链接无效或已过期');
      return;
    }

    const passwordError = validateRegisterPassword(password);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      await onResetPassword({ token, password });
      toast.success('密码已重置，请重新登录');
      onNavigate('/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '密码重置失败，请重新获取邮件链接');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex h-screen min-h-[640px] items-center justify-center overflow-y-auto p-6">
      <button
        type="button"
        onClick={() => onNavigate('/login')}
        className="absolute left-6 top-6 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回登录
      </button>

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/25">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-5 text-3xl font-black text-white">设置新密码</h1>
          <p className="mt-2 text-sm text-gray-400">为你的 Lindyson AI 账号设置新的登录密码。</p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="新密码"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="请输入新密码"
              icon={<Lock className="h-4 w-4" />}
              autoComplete="new-password"
              hint="8-128 位，需包含字母和数字，不允许空格"
            />
            <Input
              label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              placeholder="再次输入新密码"
              icon={<Lock className="h-4 w-4" />}
              autoComplete="new-password"
            />

            <Button type="submit" variant="pink" size="lg" loading={submitting} iconRight={<ArrowRight className="h-4 w-4" />}>
              重置密码
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
