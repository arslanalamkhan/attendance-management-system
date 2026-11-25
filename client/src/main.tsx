import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ApiError } from './lib/api';
import { ThemeProvider } from './lib/theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the server when a request is simply wrong; retry transient failures once.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 1,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

async function boot() {
  // Dev-only API mock for working on screens before the server has its auth routes.
  // `import.meta.env.DEV` is replaced with `false` in production builds, so this whole branch
  // (and the dynamic import) is removed by the bundler.
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_MOCK === '1') {
    const { installAuthMock } = await import('./dev/auth-mock');
    installAuthMock();
  }

  // A data router (rather than <BrowserRouter>) so pages can block navigation with `useBlocker`
  // (unsaved-changes guard in the role editor). The single splat route hands everything to <App />.
  const router = createBrowserRouter([{ path: '*', element: <App /> }]);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void boot();

