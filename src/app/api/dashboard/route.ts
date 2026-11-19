import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk } from '@/server/http';
import {
  getDashboardWidget,
  getDashboardWidgets,
} from '@/server/domain/dashboard';
import { isDashboardWidgetId } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard          — visible widget payloads in the saved order.
 * GET /api/dashboard?widget=  — one widget payload (used by the local Retry).
 *
 * The signed-in user's dashboard preferences decide which widgets are returned;
 * every payload is permission filtered in the domain. Unknown widget ids in the
 * stored preference are preserved in storage but not rendered here.
 */
export const GET = apiRoute(async ({ db, request, user }) => {
  const widget = new URL(request.url).searchParams.get('widget');
  if (widget !== null) {
    if (!isDashboardWidgetId(widget)) {
      return jsonError(404, 'widget_not_found', 'That dashboard widget is not available.');
    }
    return jsonOk({ widget: getDashboardWidget(db, user, widget) });
  }
  return jsonOk({ widgets: getDashboardWidgets(db, user) });
});
