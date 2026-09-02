from django.db import migrations, transaction
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.migrations.state import StateApps


def reset_stale_markdown_version(apps: StateApps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    """markdown.version was bumped from 1 to 2 to force a one-time
    re-render after the rich oEmbed feature landed, not because the
    format actually changed for most content. Now that it's back
    down to 1, this relabels rows already stamped 2 back to match.
    """

    Realm = apps.get_model("zerver", "Realm")
    Message = apps.get_model("zerver", "Message")

    Realm.objects.filter(rendered_description_version=2).update(rendered_description_version=1)

    stale_realm_ids = (
        Message.objects.filter(rendered_content_version=2)
        .values_list("realm_id", flat=True)
        .distinct()
    )
    for realm_id in stale_realm_ids.iterator():
        with transaction.atomic():
            Message.objects.filter(realm_id=realm_id, rendered_content_version=2).update(
                rendered_content_version=1
            )


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("zerver", "miatsuco_0008_add_email_visibility_max_min"),
    ]

    operations = [
        migrations.RunPython(
            reset_stale_markdown_version,
            reverse_code=migrations.RunPython.noop,
            elidable=True,
        )
    ]
