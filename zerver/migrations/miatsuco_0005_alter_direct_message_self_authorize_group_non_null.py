# Fork migration (miatsuco): now that every realm has a direct_message_self_authorize_group
# (set by miatsuco_0004), make the ForeignKey non-null, matching the two
# existing DM group settings.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("zerver", "miatsuco_0004_set_default_direct_message_self_authorize_group"),
    ]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="direct_message_self_authorize_group",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.RESTRICT,
                related_name="+",
                to="zerver.usergroup",
            ),
        ),
    ]
