import { endpointContracts } from '@lindyson/api-contracts';
import { apiRequest, jsonBody } from '../api/client';
import { captureAttribution } from '../state/attribution';
import { captureReferralCode, clearReferralCode } from '../state/referrals';
import { ArrowLeft,ArrowRight,KeyRound,Lock,Mail,Sparkles,UserRound,X } from 'lucide-react';
import { useEffect,useState,type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  normalizeEmail,
  validateRegisterPassword,
  validateRegisterUserName,
  type RegisterPayload,
} from '../state/auth';
import { isValidEmail } from '../state/support';
import { Button,Card,Dialog,Input } from '../ui';

type AuthMode = 'login' | 'register';

const REGISTER_CODE_RESEND_COOLDOWN_SECONDS = 60;

interface AuthPageProps {
  mode: AuthMode;
  onLoginSuccess: (payload: { email: string; password: string }) => Promise<void>;
  onRegisterCodeRequest: (payload: RegisterPayload) => Promise<{ verificationId: string; expiresAt: string }>;
  onRegisterSuccess: (payload: RegisterPayload & { password: string; verificationId: string; verificationCode: string }) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

export function AuthPage({ mode, onLoginSuccess, onRegisterCodeRequest, onRegisterSuccess, onForgotPassword, onNavigate }: AuthPageProps) {
  const [linkReferral, setLinkReferral] = useState<string | null>(captureReferralCode);
  const [manualReferral, setManualReferral] = useState('');
  const [referralError, setReferralError] = useState('');
  const cancelReferral = () => { clearReferralCode(); setLinkReferral(null); setManualReferral(''); setReferralError(''); };
  useEffect(() => {
    if (!linkReferral || mode !== 'register') return;
    let canceled = false;
    void apiRequest('/api/public/referrals/check', endpointContracts.referralCheck.response, { method: 'POST', body: jsonBody({ code: linkReferral }) })
      .then(result => { if (!canceled) setReferralError(result.valid ? '' : result.message); })
      .catch(() => { if (!canceled) setReferralError('暂时无法验证邀请，请重试或取消邀请'); });
    return () => { canceled = true; };
  }, [linkReferral, mode]);
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerCode, setRegisterCode] = useState('');
  const [registerVerificationId, setRegisterVerificationId] = useState<string | null>(null);
  const [registerCodeExpiresAt, setRegisterCodeExpiresAt] = useState('');
  const [registerCodeSentFor, setRegisterCodeSentFor] = useState('');
  const [registerCodeCooldownUntil, setRegisterCodeCooldownUntil] = useState(0);
  const [registerCodeCooldownFor, setRegisterCodeCooldownFor] = useState('');
  const [registerCodeRemainingSeconds, setRegisterCodeRemainingSeconds] = useState(0);
  const [registerCodeSending, setRegisterCodeSending] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState(email);
  const [forgotSending, setForgotSending] = useState(false);

  const isRegister = mode === 'register';
  const currentRegisterCodeCooldownKey = getRegisterCodeCooldownKey(email);
  const isRegisterCodeCoolingDown = registerCodeCooldownFor === currentRegisterCodeCooldownKey && registerCodeRemainingSeconds > 0;
  const registerCodeButtonLabel = isRegisterCodeCoolingDown
    ? `${registerCodeRemainingSeconds}s 后重发`
    : registerVerificationId ? '重新发送' : '发送验证码';

  const clearRegisterVerification = () => {
    setRegisterCode('');
    setRegisterVerificationId(null);
    setRegisterCodeExpiresAt('');
    setRegisterCodeSentFor('');
  };

  useEffect(() => {
    setUserName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    clearRegisterVerification();
  }, [mode]);

  useEffect(() => {
    if (!registerCodeCooldownUntil) {
      setRegisterCodeRemainingSeconds(0);
      return;
    }

    const tick = () => {
      const nextSeconds = Math.max(0, Math.ceil((registerCodeCooldownUntil - Date.now()) / 1000));
      setRegisterCodeRemainingSeconds(nextSeconds);
      if (nextSeconds === 0) setRegisterCodeCooldownUntil(0);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [registerCodeCooldownUntil]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValidEmail(normalizeEmail(email))) {
      toast.error('请输入有效邮箱');
      return;
    }

    if (!isRegister && password.length < 6) {
      toast.error('密码至少需要 6 位');
      return;
    }

    if (isRegister) {
      const userNameError = validateRegisterUserName(userName);
      if (userNameError) {
        toast.error(userNameError);
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

      const verificationKey = getRegisterVerificationKey(userName, email);
      if (!registerVerificationId || registerCodeSentFor !== verificationKey) {
        toast.error('请先获取邮箱验证码');
        return;
      }

      const normalizedRegisterCode = registerCode.trim();
      if (!/^\d{6}$/.test(normalizedRegisterCode)) {
        toast.error('请输入 6 位邮箱验证码');
        return;
      }

      setRegistering(true);
      try {
        const referralCode = linkReferral ?? manualReferral.trim();
        if (referralCode) {
          const result = await apiRequest('/api/public/referrals/check', endpointContracts.referralCheck.response, {
            method: 'POST', body: jsonBody({ code: referralCode }),
          });
          if (!result.valid) { setReferralError(result.message); return; }
        }
        const attribution = captureAttribution();
        await onRegisterSuccess({
          ...(referralCode ? { referralCode } : {}),
          ...(attribution ? { attribution } : {}),
          userName: userName.trim(),
          email: normalizeEmail(email),
          password,
          verificationId: registerVerificationId,
          verificationCode: normalizedRegisterCode,
        });
        toast.success('注册成功，已进入工作台');
      } catch (error) {
        if (linkReferral || manualReferral.trim()) setReferralError(error instanceof Error ? error.message : '注册失败，请重试或取消邀请');
        toast.error(error instanceof Error ? error.message : '注册失败，请稍后重试');
      } finally {
        setRegistering(false);
      }
      return;
    }

    setRegistering(true);
    try {
      await onLoginSuccess({ email: normalizeEmail(email), password });
      toast.success('登录成功，已进入工作台');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登录失败，请检查邮箱和密码');
    } finally {
      setRegistering(false);
    }
  };

  const sendRegisterCode = async () => {
    const userNameError = validateRegisterUserName(userName);
    if (userNameError) {
      toast.error(userNameError);
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      toast.error('请输入有效邮箱');
      return;
    }

    const cooldownKey = getRegisterCodeCooldownKey(normalizedEmail);
    if (registerCodeCooldownFor === cooldownKey && registerCodeRemainingSeconds > 0) {
      toast.error(`请 ${registerCodeRemainingSeconds} 秒后再重新发送`);
      return;
    }

    setRegisterCodeSending(true);
    try {
      const verificationKey = getRegisterVerificationKey(userName, normalizedEmail);
      const result = await onRegisterCodeRequest({ userName: userName.trim(), email: normalizedEmail });
      setRegisterVerificationId(result.verificationId);
      setRegisterCodeExpiresAt(result.expiresAt);
      setRegisterCodeSentFor(verificationKey);
      setRegisterCodeCooldownFor(cooldownKey);
      setRegisterCodeCooldownUntil(Date.now() + REGISTER_CODE_RESEND_COOLDOWN_SECONDS * 1000);
      setRegisterCodeRemainingSeconds(REGISTER_CODE_RESEND_COOLDOWN_SECONDS);
      setRegisterCode('');
      toast.success('邮箱验证码已发送');
    } catch (error) {
      clearRegisterVerification();
      toast.error(error instanceof Error ? error.message : '验证码发送失败，请稍后重试');
    } finally {
      setRegisterCodeSending(false);
    }
  };

  const submitForgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedForgotEmail = normalizeEmail(forgotEmail);
    if (!isValidEmail(normalizedForgotEmail)) {
      toast.error('请输入有效邮箱');
      return;
    }

    setForgotSending(true);
    try {
      await onForgotPassword(normalizedForgotEmail);
      toast.success('如果该邮箱已注册，重置密码邮件会发送到该邮箱');
      setForgotOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邮件发送请求失败，请稍后重试');
    } finally {
      setForgotSending(false);
    }
  };

  return (
    <main className="relative flex h-screen min-h-[680px] items-center justify-center overflow-y-auto p-6">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="absolute left-6 top-6 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回首页
      </button>

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/25">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-5 text-3xl font-black text-white">
            {isRegister ? '创建 Lindyson AI 账号' : '登录 Lindyson AI'}
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {isRegister ? '注册后进入 AI 内容创作工作台。' : '登录后继续管理你的内容资产与创作任务。'}
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <Input
                label="用户名"
                value={userName}
                onChange={event => {
                  setUserName(event.target.value);
                  clearRegisterVerification();
                }}
                placeholder="请输入用户名"
                icon={<UserRound className="h-4 w-4" />}
                autoComplete="name"
                maxLength={30}
                hint="2-30 个字符，可使用中文、英文、数字、空格、_ 和 -"
              />
            )}
            {isRegister ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <Input
                  label="邮箱"
                  type="email"
                  value={email}
                  onChange={event => {
                    setEmail(event.target.value);
                    clearRegisterVerification();
                  }}
                  placeholder="name@company.com"
                  icon={<Mail className="h-4 w-4" />}
                  autoComplete="email"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  loading={registerCodeSending}
                  disabled={isRegisterCodeCoolingDown}
                  onClick={sendRegisterCode}
                  className="h-[42px] min-w-[112px] rounded-xl px-4"
                >
                  {registerCodeButtonLabel}
                </Button>
              </div>
            ) : (
              <Input
                label="邮箱"
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="name@company.com"
                icon={<Mail className="h-4 w-4" />}
                autoComplete="email"
              />
            )}
            {isRegister && !linkReferral && (
              <Input label="邀请码（选填）" value={manualReferral} maxLength={64} autoComplete="off"
                onChange={event => { setManualReferral(event.target.value); setReferralError(''); }} placeholder="填写好友提供的邀请码" />
            )}
            {isRegister && referralError && (
              <div role="alert" className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
                <p>{referralError}</p>
                <Button type="button" variant="secondary" size="sm" onClick={cancelReferral}>取消邀请，继续普通注册</Button>
              </div>
            )}
            {isRegister && (
              <Input
                label="邮箱验证码"
                value={registerCode}
                onChange={event => setRegisterCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="请输入 6 位验证码"
                icon={<KeyRound className="h-4 w-4" />}
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                hint={registerCodeExpiresAt ? '验证码已发送，10 分钟内有效' : '请先获取邮箱验证码'}
              />
            )}
            <Input
              label="密码"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="请输入密码"
              icon={<Lock className="h-4 w-4" />}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              hint={isRegister ? '8-128 位，需包含字母和数字，不允许空格' : undefined}
            />
            {isRegister && (
              <Input
                label="确认密码"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="再次输入密码"
                icon={<Lock className="h-4 w-4" />}
                autoComplete="new-password"
              />
            )}

            {!isRegister && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotOpen(true);
                  }}
                  className="text-xs font-semibold text-purple-300 transition-colors hover:text-white"
                >
                  忘记密码？
                </button>
              </div>
            )}

            <Button type="submit" variant="pink" size="lg" loading={registering} iconRight={<ArrowRight className="h-4 w-4" />}>
              {isRegister ? '注册并进入工作台' : '登录'}
            </Button>
          </form>

          <div className="mt-5 border-t border-white/10 pt-5 text-center text-sm text-gray-400">
            {isRegister ? '已有账号？' : '还没有账号？'}
            <button
              type="button"
              onClick={() => onNavigate(isRegister ? '/login' : '/register')}
              className="ml-1 font-semibold text-purple-300 transition-colors hover:text-white"
            >
              {isRegister ? '返回登录' : '立即注册'}
            </button>
          </div>
        </Card>
      </div>

      {forgotOpen && (
        <Dialog
          onClose={() => setForgotOpen(false)}
          closeDisabled={forgotSending}
          titleId="forgot-password-dialog-title"
          descriptionId="forgot-password-dialog-description"
          panelClassName="max-w-sm"
        >
          <Card variant="modal" className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="forgot-password-dialog-title" className="text-lg font-bold text-white">找回密码</h2>
                <p id="forgot-password-dialog-description" className="mt-1 text-xs leading-5 text-gray-400">输入注册邮箱，我们会发送密码重置链接。</p>
              </div>
              <button
                type="button"
                aria-label="关闭找回密码窗口"
                disabled={forgotSending}
                onClick={() => setForgotOpen(false)}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submitForgot} className="mt-5 space-y-4">
              <Input
                label="邮箱"
                type="email"
                value={forgotEmail}
                onChange={event => setForgotEmail(event.target.value)}
                placeholder="name@company.com"
                icon={<Mail className="h-4 w-4" />}
              />
              <div className="flex justify-end gap-2">
                <Button data-dialog-initial-focus type="button" variant="secondary" size="md" disabled={forgotSending} onClick={() => setForgotOpen(false)}>
                  取消
                </Button>
                <Button type="submit" variant="pink" size="md" loading={forgotSending}>
                  发送邮件
                </Button>
              </div>
            </form>
          </Card>
        </Dialog>
      )}
    </main>
  );
}

function getRegisterVerificationKey(userName: string, email: string) {
  return `${userName.trim()}|${normalizeEmail(email)}`;
}

function getRegisterCodeCooldownKey(email: string) {
  return normalizeEmail(email);
}
