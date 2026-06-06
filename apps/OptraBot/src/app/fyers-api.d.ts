declare module 'fyers-api-v3' {
  // ---------------------------
  // Fyers Model Class
  // ---------------------------
  export class fyersModel {
    constructor();

    initialize(): Promise<void>;
    logout_user(): Promise<CommonResponse>;

    // Setters for app configuration
    setAppId(appId: string): void;
    setRedirectUrl(redirectUrl: string): void;
    setAccessToken(token: string): void;
    isTokenValid(): Promise<boolean>;
    getAccessToken(): Promise<string>;
    get_funds(): Promise<FyersAPI.FundsResponse>;
    getOptionChain(
      request: FyersAPI.OptionChainRequest,
    ): Promise<FyersAPI.OptionChainResponse>;

    getHistory(
      params: FyersAPI.HistoryQueryRequest,
    ): Promise<FyersAPI.HistoryResponse>;

    // Authentication Methods
    generateAuthCode(): string;
    generate_access_token(
      request: FyersAPI.AccessTokenRequest,
    ): Promise<FyersAPI.AccessTokenResponse>;

    // Account APIs
    get_profile(): Promise<FyersAPI.AccountProfile>;
    getBalance(): Promise<FyersAPI.BalanceResponse>;

    // Market Data APIs
    getQuotes(request: FyersAPI.QuoteRequest): Promise<FyersAPI.QuotesResponse>;

    // Order APIs
    placeOrder(
      order: FyersAPI.PlaceOrderRequest,
    ): Promise<FyersAPI.OrderResponse>;
    getOrders(): Promise<FyersAPI.OrdersListResponse>;
    getTransactions(): Promise<FyersAPI.TransactionsResponse>;
  }

  // ---------------------------
  // Namespace for types
  // ---------------------------
  export namespace FyersAPI {
    export type Candle = [
      time: number,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number,
    ];

    export interface OptionChainRequest {
      symbol: string; // e.g., "NSE:RELIANCE-EQ"
      strikecount: number; // e.g., 5
      timestamp: string;
      greeks: 1 | 0; // 1 to include greeks, 0 to exclude
    }

    export interface RefreshTokenRequest {
      client_id: string;
      grant_type: 'refresh_token';
      refresh_token: string;
    }

    export interface AccessTokenRequest {
      secret_key: string;
      auth_code: string;
    }

    export interface HistoryQueryRequest {
      symbol: string;
      resolution: string;
      date_format: 0 | 1;
      range_from: string;
      range_to: string;
      cont_flag: 0 | 1;
      oi_flag: 0 | 1;
    }

    export interface CommonResponse {
      s: Status; // status
      code: number;
      message: string;
    }

    export interface HistoryResponse extends CommonResponse {
      candles: Candle[];
    }

    export interface FundsResponse extends CommonResponse {
      fund_limit: FyersAPI.FundLimit[];
    }

    export interface AccessTokenResponse extends CommonResponse {
      access_token: string;
    }

    export interface OptionChainResponse extends CommonResponse {
      data: {
        callOi: number;
        putOi: number;
        expiryData: FyersAPI.ExpiryData[];
        indiavixData: FyersAPI.IndiaVixData;
        optionsChain: FyersAPI.OptionChainData[];
      };
    }

    export interface ExpiryData {
      date: string; // e.g., "2024-12-26"
      expiry: string; // e.g., "1714039200"
    }

    export interface IndiaVixData {
      ask: number;
      bid: number;
      description: string;
      ex_symbol: string;
      exchange: string;
      fyToken: string;
      ltp: number;
      ltpch: number;
      ltpchp: number;
      option_type: string;
      strike_price: number;
      symbol: string;
    }

    export interface OptionChainData {
      ask: number;
      bid: number;
      fyToken: string;
      ltp: number;
      ltpch: number;
      ltpchp: number;
      oi: number;
      oich: number;
      oichp: number;
      option_type: string;
      prev_oi: number;
      strike_price: number;
      symbol: string;
      volume: number;
      ex_symbol: string;
      exchange: string;
      description: string;
      greeks?: GreekData;
    }

    export interface GreekData {
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
      iv: number;
    }

    export interface FundLimit {
      id: number;
      title: string;
      equityAmount: number;
      commodityAmount: number;
    }

    // Account Information
    export interface AccountProfile extends CommonResponse {
      data: {
        name: string;
        image: string;
        display_name: string;
        email_id: string;
        PAN: string;
        fy_id: string;
        pin_change_date: string;
        mobile_number: string;
        totp: boolean;
        pwd_change_date: string;
        pwd_to_expire: number;
        ddpi_enabled: boolean;
        mtf_enabled: boolean;
      };
    }

    export interface BalanceResponse {
      net_cash: number;
      ledger_balance: number;
      margin_used: number;
      available_margin: number;
    }

    // Market Data
    export interface QuoteRequest {
      symbols: string[]; // e.g., ["NSE:RELIANCE-EQ"]
    }

    export interface Quote {
      symbol: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      last_price: number;
      timestamp: string; // ISO 8601 format
    }

    export interface QuotesResponse {
      [symbol: string]: Quote;
    }

    // Orders
    export type OrderType = 'LIMIT' | 'MARKET';
    export type ProductType = 'CNC' | 'MIS' | 'NRML';
    export type BuySell = 'BUY' | 'SELL';

    export interface PlaceOrderRequest {
      symbol: string;
      qty: number;
      type: OrderType;
      side: BuySell;
      product_type: ProductType;
      limit_price?: number;
      stop_price?: number;
      validity?: 'DAY' | 'IOC';
    }

    export interface OrderResponse {
      id: string;
      status: 'AWAITING' | 'COMPLETE' | 'CANCELLED' | 'REJECTED';
      placed_on: string;
      filled_qty: number;
      pending_qty: number;
    }

    export interface OrdersListResponse {
      orders: OrderResponse[];
    }

    // Transactions
    export interface Transaction {
      id: string;
      symbol: string;
      qty: number;
      side: BuySell;
      price: number;
      timestamp: string;
      order_type: OrderType;
    }

    export interface TransactionsResponse {
      transactions: Transaction[];
    }

    export interface APIError {
      code: number;
    }
  }
}
