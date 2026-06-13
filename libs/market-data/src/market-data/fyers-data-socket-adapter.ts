export interface DataSocketLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
  connect(): void;
  subscribe(symbols: string[], depth?: boolean): void;
  unsubscribe(symbols: string[]): void;
  mode(mode: unknown): void;
  autoReconnect?(tries: number): void;
  autoreconnect?(tries: number): void;
  close?(): void;
  isConnected?(): boolean;
  LiteMode?: unknown;
  FullMode?: unknown;
}

export function createFyersDataSocket(
  accessToken: string,
  logPath = '',
  logEnabled = false,
): DataSocketLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fyersDataSocket } = require('fyers-api-v3') as {
    fyersDataSocket: {
      getInstance: (
        token: string,
        path: string,
        logging: boolean,
      ) => DataSocketLike;
    };
  };
  return fyersDataSocket.getInstance(accessToken, logPath, logEnabled);
}