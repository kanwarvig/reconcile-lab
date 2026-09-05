export const MESSY_CUSTOMERS_CSV = `crm_id,company,email_address,tier,account_status,balance,modified_at,account_state
C-001,Acme Solar,OPS@ACMESOLAR.TEST,Starter," ACTIVE ",$120.40,2026-09-01T09:00:00.000Z,
C-002,Beacon Works,finance@beacon.test,GROWTH,active,"2,401.00",2026-09-01T09:05:00.000Z,
C-003,Cedar & Co,hello@cedar.test,scale,active,$89.12,2026-09-01T09:10:00.000Z,
C-004,Delta Freight,ops@delta.test,growth,active,$710.00,2026-09-01T09:15:00.000Z,
C-004,Delta Freight,ops@delta.test,growth,active,$710.00,2026-09-01T09:15:00.000Z,
C-005,Ember Studio,team@ember.test,starter,paused,$0.00,2026-09-01T09:20:00.000Z,
C-006,Fern Foods,accounts@fern.test,growth,,345.70,2026-09-01T09:25:00.000Z,active
C-007,Grove Labs,bad-email,scale,,999.99,2026-09-01T09:30:00.000Z,active
C-008,Harbor Supply,billing@harbor.test,growth,,151.14,2026-09-01T09:35:00.000Z,active
C-009,Iris Events,hello@iris.test,starter,,80.00,2026-09-01T09:40:00.000Z,paused
C-010,Juniper Legal,admin@juniper.test,scale,,1200.00,2026-09-01T09:45:00.000Z,active
C-011,Kite Robotics,finance@kite.test,growth,,640.50,2026-09-01T09:50:00.000Z,active`;

import deltaFixture from "./deltas.json";

export const INCREMENTAL_CHANGES_JSON = JSON.stringify(deltaFixture);

