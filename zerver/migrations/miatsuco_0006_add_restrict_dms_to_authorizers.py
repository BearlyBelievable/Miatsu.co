# Fork migration (miatsuco): add the personal miatsuco_restrict_dms_to_authorizers
# setting. A boolean takes a static default, so unlike a group-setting field
# this needs only a single migration (no add-nullable / backfill / non-null
# sequence). The field lives on UserBaseSettings, so it is added to both
# RealmUserDefault (the org-wide default) and UserProfile (the per-user value),
# mirroring miatsuco_0002.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("zerver", "miatsuco_0005_alter_direct_message_self_authorize_group_non_null"),
    ]

    operations = [
        migrations.AddField(
            model_name="realmuserdefault",
            name="miatsuco_restrict_dms_to_authorizers",
            field=models.BooleanField(db_default=False, default=False),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="miatsuco_restrict_dms_to_authorizers",
            field=models.BooleanField(db_default=False, default=False),
        ),
    ]
