export type SquareJson =
  | null
  | boolean
  | number
  | string
  | SquareJson[]
  | { [key: string]: SquareJson };

export type SquareClientConfig = {
  accessToken: string;
  locationId: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type SquareConnectionStatus = {
  provider: "square";
  configured: boolean;
  connected: boolean;
};

export type SquareUtcRange = {
  startAt: string;
  endAt: string;
};

export type SquareMoney = {
  amount?: number;
  currency?: string;
};
