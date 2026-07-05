# Fork migration (miatsuco): add the direct_message_self_authorize_group realm setting.
#
# Added as a nullable ForeignKey first; miatsuco_0004 sets the default group
# for existing realms and miatsuco_0005 makes it non-null, mirroring how
# upstream added direct_message_initiator_group / direct_message_permission_group
# (migrations 0549, 0550, 0551). A group-permission setting cannot use a static
# default, which is why it takes three steps.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("zerver", "miatsuco_0002_add_web_show_upload_thumbnails"),
        ("zerver", "0804_backfill_user_created_audit_logs"),
    ]

    operations = [
        migrations.AddField(
            model_name="realm",
            name="direct_message_self_authorize_group",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.RESTRICT,
                related_name="+",
                to="zerver.usergroup",
            ),
        ),
    ]
