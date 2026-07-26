import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("zerver", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="BulkFieldRemediationJob",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("field_name", models.TextField()),
                ("from_values", models.JSONField()),
                ("to_value", models.JSONField()),
                ("status", models.PositiveSmallIntegerField(default=1)),
                ("started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("finished_at", models.DateTimeField(null=True)),
                ("last_batch_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("total_violating_count", models.PositiveIntegerField()),
                ("processed_count", models.PositiveIntegerField(default=0)),
                ("last_processed_user_id", models.PositiveIntegerField(default=0)),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name="bulkfieldremediationjob",
            index=models.Index(
                fields=["realm", "field_name", "status"],
                name="bulk_remediation_realm_field_status",
            ),
        ),
    ]
