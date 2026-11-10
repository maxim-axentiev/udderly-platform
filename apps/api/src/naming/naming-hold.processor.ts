import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { NAMING_HOLD_QUEUE } from "../queue/queue.constants";
import { NamingReservationService } from "./naming-reservation.service";

type NamingHoldJobData = {
  reservationId?: string;
};

@Processor(NAMING_HOLD_QUEUE)
export class NamingHoldProcessor extends WorkerHost {
  private readonly logger = new Logger(NamingHoldProcessor.name);

  constructor(
    @Inject(NamingReservationService)
    private readonly reservations: NamingReservationService,
  ) {
    super();
  }

  async process(job: Job<NamingHoldJobData>): Promise<void> {
    if (!job.data.reservationId) {
      this.logger.error("Naming hold job missing reservation id");
      return;
    }
    await this.reservations.releaseExpiredHold(job.data.reservationId);
  }
}
