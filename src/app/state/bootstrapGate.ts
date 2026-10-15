export interface BootstrapGate {
  current: boolean;
}

/** React 依赖变化和 StrictMode 重放都不能再次发起身份冷启动。 */
export function claimBootstrapStart(gate: BootstrapGate) {
  if (gate.current) return false;
  gate.current = true;
  return true;
}
