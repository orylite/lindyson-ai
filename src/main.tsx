
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from '@tanstack/react-query';
import App from "./app/App";
import { queryClient } from './app/api/queryClient';
import { recoverFromStaleChunk } from './app/state/staleChunkRecovery';
import "./styles/index.css";

window.addEventListener('vite:preloadError', event => {
  event.preventDefault();
  recoverFromStaleChunk(window.sessionStorage, __LINDYSON_BUILD_ID__, () => window.location.reload());
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
