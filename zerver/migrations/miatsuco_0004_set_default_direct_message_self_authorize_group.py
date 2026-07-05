# Fork migration (miatsuco): set the default value of direct_message_self_authorize_group
# for existing realms to the NOBODY system group. This preserves the prior
# behavior: with an empty self-authorize group, a direct message is authorized only when
# a direct_message_permission_group member is present, exactly as before this
# feature existed. An admin opts in by widening the self-authorize group.

from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.migrations.state import StateApps
from django.db.models import OuterRef


def set_default_value_for_direct_message_self_authorize_group(
    apps: StateApps, schema_editor: BaseDatabaseSchemaEditor
) -> None:
    Realm = apps.get_model("zerver", "Realm")
    NamedUserGroup = apps.get_model("zerver", "NamedUserGroup")

    NOBODY_GROUP_NAME = "role:nobody"

    Realm.objects.filter(
        direct_message_self_authorize_group=None,
    ).update(
        direct_message_self_authorize_group=NamedUserGroup.objects.filter(
            name=NOBODY_GROUP_NAME, realm=OuterRef("id"), is_system_group=True
        ).values("pk")
    )


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("zerver", "miatsuco_0003_add_direct_message_self_authorize_group"),
    ]

    operations = [
        migrations.RunPython(
            set_default_value_for_direct_message_self_authorize_group,
            elidable=True,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
