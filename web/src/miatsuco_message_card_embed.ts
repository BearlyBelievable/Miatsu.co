import {isValid, parseISO} from "date-fns";
import $ from "jquery";

import {$t} from "./i18n.ts";
import * as timerender from "./timerender.ts";

const RECENT_POST_CUTOFF_HOURS = 24;

function format_post_timestamp(date: Date): string {
    const ms_old = Date.now() - date.getTime();
    const hours_old = ms_old / (60 * 60 * 1000);
    if (hours_old >= RECENT_POST_CUTOFF_HOURS) {
        const is_current_year = date.getFullYear() === new Date().getFullYear();
        return timerender.get_localized_date_or_time_for_format(
            date,
            is_current_year ? "dayofyear" : "dayofyear_year",
        );
    }

    const minutes_old = Math.floor(ms_old / (60 * 1000));
    if (minutes_old < 1) {
        return $t({defaultMessage: "Now"});
    }
    if (minutes_old < 60) {
        return $t({defaultMessage: "{minutes}m"}, {minutes: minutes_old});
    }
    return $t({defaultMessage: "{hours}h"}, {hours: Math.floor(hours_old)});
}

export function enhance_message_card_embed_timestamps(content: JQuery): void {
    content.find(".message-card-embed-timestamp").each((_index, element) => {
        const $time = $(element);
        const time_str = $time.attr("datetime");
        if (time_str === undefined) {
            return;
        }
        const timestamp = parseISO(time_str);
        if (!isValid(timestamp)) {
            return;
        }
        $time.text(format_post_timestamp(timestamp));
    });
}
