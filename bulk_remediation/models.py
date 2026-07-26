from django.db import models
from django.utils.timezone import now as timezone_now
from typing_extensions import override

from zerver.models import Realm

# Generic model for a bulk fixer for existing UserProfile fields. See
# zerver/worker/bulk_remediation.py for the worker that processes
# these. Rate-limited and resumable.


class BulkFieldRemediationJob(models.Model):
    realm = models.ForeignKey(Realm, on_delete=models.CASCADE)

    field_name = models.TextField()
    # Plural since multiple distinct stored values can all violate at
    # once (e.g. a ceiling/floor policy), but every violator corrects
    # to the same single target, so to_value isn't a list.
    from_values = models.JSONField()
    # TODO: to_value could become a list too, to support remapping to
    # different targets instead of one shared clamp.
    to_value = models.JSONField()

    STATUS_RUNNING = 1
    STATUS_COMPLETED = 2
    STATUS_FAILED = 3
    status = models.PositiveSmallIntegerField(default=STATUS_RUNNING)

    started_at = models.DateTimeField(default=timezone_now)
    # Gets updated every time a batch completes successfully. Used for
    # is_stale to tell "actively progressing" jobs apart from "stuck at
    # STATUS_RUNNING forever."
    last_batch_at = models.DateTimeField(default=timezone_now)
    finished_at = models.DateTimeField(null=True)

    total_violating_count = models.PositiveIntegerField()
    processed_count = models.PositiveIntegerField(default=0)

    # Cursor for resuming batches in a stable order. Ordering by id
    # means a batch never has to remember more state than "the highest
    # id it has already handled."
    last_processed_user_id = models.PositiveIntegerField(default=0)

    # How long a RUNNING job may go without a batch completing before
    # it's treated as abandoned rather than actively working. Generous
    # relative to how quickly a healthy queue actually processes a
    # batch, so this only fires for a genuinely stuck job, not normal
    # queue latency.
    STALE_AFTER_SECONDS = 600

    class Meta:
        indexes = [
            models.Index(
                fields=["realm", "field_name", "status"],
                name="bulk_remediation_realm_field_status",
            ),
        ]

    @override
    def __str__(self) -> str:
        return f"{self.field_name} remediation for {self.realm!r} ({self.get_status_display()})"

    def get_status_display(self) -> str:
        return {
            self.STATUS_RUNNING: "running",
            self.STATUS_COMPLETED: "completed",
            self.STATUS_FAILED: "failed",
        }[self.status]

    def is_stale(self) -> bool:
        if self.status != self.STATUS_RUNNING:
            return False
        return (timezone_now() - self.last_batch_at).total_seconds() > self.STALE_AFTER_SECONDS
