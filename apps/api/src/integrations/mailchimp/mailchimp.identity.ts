export function mailchimpAccountExternalId(accountId: string): string {
  return accountId;
}

export function mailchimpAudienceExternalId(listId: string): string {
  return listId;
}

export function mailchimpGrowthExternalId(listId: string, month: string): string {
  return `${listId}:${month}`;
}

export function mailchimpActivityExternalId(listId: string, day: string): string {
  return `${listId}:${day}`;
}

export function mailchimpCampaignExternalId(campaignId: string): string {
  return campaignId;
}

export function mailchimpReportExternalId(campaignId: string): string {
  return campaignId;
}

export function mailchimpClickExternalId(campaignId: string, linkId: string): string {
  return `${campaignId}:${linkId}`;
}
