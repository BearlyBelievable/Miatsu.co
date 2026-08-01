from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        # TODO: update this dependency to upstream's migration point.
        ("zerver", "miatsuco_0007_add_email_visibility_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="realm",
            name="email_address_visibility_max",
            # UserProfile.EMAIL_ADDRESS_VISIBILITY_EVERYONE
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="realm",
            name="email_address_visibility_min",
            # UserProfile.EMAIL_ADDRESS_VISIBILITY_NOBODY
            field=models.PositiveSmallIntegerField(default=4),
        ),
    ]
