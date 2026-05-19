import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMsg: ""
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-900 border-t-4 border-red-500">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">Application Error</h1>
          <div className="bg-white p-6 rounded-lg shadow-lg border border-slate-200 max-w-2xl w-full">
            <p className="text-red-600 mb-4 font-mono text-sm bg-red-50 p-4 rounded-md overflow-auto">
              {this.state.errorMsg}
            </p>
            <p className="text-slate-600 mb-6 text-sm">
              An unexpected error occurred. This might be due to a temporary state issue or a required dependency issue. You can try refreshing the page.
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
