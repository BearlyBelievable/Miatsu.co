# Composite (realm, email_address_visibility) index for the email
# visibility policy's preview and remediation queries.

from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        # TODO: update this dependency to upstream's migration point.
        ("zerver", "miatsuco_0006_add_restrict_dms_to_authorizers"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="userprofile",
            index=models.Index(
                fields=["realm", "email_address_visibility"],
                name="zerver_userprofile_realm_email_visibility",
            ),
        ),
    ]
