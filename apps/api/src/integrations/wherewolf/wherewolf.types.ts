import { WHEREWOLF_GUEST_SELECTION_CROPPED } from "./wherewolf.constants";

export type WherewolfGuestSelection =
  typeof WHEREWOLF_GUEST_SELECTION_CROPPED;

export type WherewolfClientConfig = {
  apiKey: string;
  appId: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type WherewolfUtcRange = {
  dateBegin: string;
  dateEnd: string;
};

export type WherewolfReservationsGetRequest = {
  dateBegin: string;
  dateEnd: string;
  key: string;
  pool: string;
};

export type WherewolfGuestGetByFilterRequest = {
  filter: {
    dateRange: {
      dateAfter: string;
      dateBefore: string;
    };
  };
  limit: number;
  selection: WherewolfGuestSelection;
  key: string;
  pool: string;
};

export type WherewolfJson =
  | null
  | boolean
  | number
  | string
  | WherewolfJson[]
  | { [key: string]: WherewolfJson };

export type WherewolfConnectionStatus = {
  provider: "wherewolf";
  configured: boolean;
  connected: boolean;
};
