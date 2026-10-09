export type MailchimpActivityReplacePlan = {
  listId: string;
  replaceDates: string[];
  skippedUnpublishedDates: string[];
};

export type MailchimpReportReplacePlan = {
  replaceCampaignIds: string[];
  skippedMissingReportIds: string[];
};

export function planMailchimpActivityReplacement(input: {
  listId: string;
  publishedDates: readonly string[];
  possiblyUnpublishedDates: readonly string[];
}): MailchimpActivityReplacePlan {
  return {
    listId: input.listId,
    replaceDates: [...input.publishedDates],
    skippedUnpublishedDates: [...input.possiblyUnpublishedDates],
  };
}

export function planMailchimpReportReplacement(input: {
  sentCampaignIds: readonly string[];
  reportedCampaignIds: readonly string[];
}): MailchimpReportReplacePlan {
  const reported = new Set(input.reportedCampaignIds);
  const replaceCampaignIds = input.sentCampaignIds.filter((id) => reported.has(id));
  const skippedMissingReportIds = input.sentCampaignIds.filter((id) => !reported.has(id));
  return { replaceCampaignIds, skippedMissingReportIds };
}

export type MailchimpLinkReplacePlan = {
  campaignId: string;
  replace: boolean;
  skippedIncomplete: boolean;
};

/**
 * Empty click-details with a positive unique-click total is treated as an
 * incomplete payload, not a true zero. Existing link rows are left in place.
 */
export function planMailchimpLinkReplacement(input: {
  campaignId: string;
  uniqueClicks?: number;
  detailCount: number;
}): MailchimpLinkReplacePlan {
  const skippedIncomplete =
    (input.uniqueClicks ?? 0) > 0 && input.detailCount === 0;
  return {
    campaignId: input.campaignId,
    replace: !skippedIncomplete,
    skippedIncomplete,
  };
}
