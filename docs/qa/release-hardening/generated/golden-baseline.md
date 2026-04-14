# Golden Baseline

- 生成时间：2026-04-14T08:07:30.275Z
- 分支：`unknown`
- HEAD：`unknown`

## Git Snapshot

```text
(clean)
```

## Route Inventory

总计：173 个路由端点

| Method | Path | Source |
|---|---|---|
| POST | `/api/ai/anomaly-analysis` | `backend/src/routes/ai.js` |
| POST | `/api/ai/anomaly-analysis/save-kb` | `backend/src/routes/ai.js` |
| POST | `/api/ai/cvc-risk-explain` | `backend/src/routes/ai.js` |
| POST | `/api/ai/ktv-root-cause` | `backend/src/routes/ai.js` |
| POST | `/api/ai/labs-analysis` | `backend/src/routes/ai.js` |
| POST | `/api/ai/medication-advice` | `backend/src/routes/ai.js` |
| POST | `/api/ai/nlp-query` | `backend/src/routes/ai.js` |
| POST | `/api/ai/patient-trend` | `backend/src/routes/ai.js` |
| POST | `/api/ai/qc-monthly-insight` | `backend/src/routes/ai.js` |
| GET | `/api/alerts` | `backend/src/routes/alerts.js` |
| PATCH | `/api/alerts/:id/ack` | `backend/src/routes/alerts.js` |
| POST | `/api/alerts/run-checks` | `backend/src/routes/alerts.js` |
| GET | `/api/alerts/summary` | `backend/src/routes/alerts.js` |
| POST | `/api/auth/change-password` | `backend/src/routes/auth.js` |
| POST | `/api/auth/login` | `backend/src/routes/auth.js` |
| POST | `/api/auth/logout` | `backend/src/routes/auth.js` |
| GET | `/api/auth/me` | `backend/src/routes/auth.js` |
| GET | `/api/cqi` | `backend/src/routes/cqi.js` |
| POST | `/api/cqi` | `backend/src/routes/cqi.js` |
| GET | `/api/cqi/:id` | `backend/src/routes/cqi.js` |
| PUT | `/api/cqi/:id` | `backend/src/routes/cqi.js` |
| POST | `/api/cqi/defects` | `backend/src/routes/cqi.js` |
| GET | `/api/cqi/defects/list` | `backend/src/routes/cqi.js` |
| GET | `/api/cqi/user-options` | `backend/src/routes/cqi.js` |
| GET | `/api/devices/consumables` | `backend/src/routes/devices.js` |
| POST | `/api/devices/consumables` | `backend/src/routes/devices.js` |
| DELETE | `/api/devices/consumables/:id` | `backend/src/routes/devices.js` |
| GET | `/api/devices/consumables/:id/last-inbound` | `backend/src/routes/devices.js` |
| PATCH | `/api/devices/consumables/:id/stock` | `backend/src/routes/devices.js` |
| POST | `/api/devices/consumables/inbound` | `backend/src/routes/devices.js` |
| GET | `/api/devices/consumables/outbound-lines` | `backend/src/routes/devices.js` |
| GET | `/api/devices/consumables/patient-usage` | `backend/src/routes/devices.js` |
| GET | `/api/devices/consumables/today-summary` | `backend/src/routes/devices.js` |
| GET | `/api/devices/machines` | `backend/src/routes/devices.js` |
| POST | `/api/devices/machines` | `backend/src/routes/devices.js` |
| DELETE | `/api/devices/machines/:id` | `backend/src/routes/devices.js` |
| PATCH | `/api/devices/machines/:id` | `backend/src/routes/devices.js` |
| GET | `/api/devices/machines/:id/alerts` | `backend/src/routes/devices.js` |
| POST | `/api/devices/machines/:id/alerts` | `backend/src/routes/devices.js` |
| GET | `/api/devices/machines/:id/maintenance` | `backend/src/routes/devices.js` |
| POST | `/api/devices/machines/:id/maintenance` | `backend/src/routes/devices.js` |
| PATCH | `/api/devices/machines/:id/status` | `backend/src/routes/devices.js` |
| GET | `/api/devices/maintenance` | `backend/src/routes/devices.js` |
| POST | `/api/devices/maintenance` | `backend/src/routes/devices.js` |
| GET | `/api/devices/water-daily-inspections` | `backend/src/routes/devices.js` |
| POST | `/api/devices/water-daily-inspections` | `backend/src/routes/devices.js` |
| GET | `/api/devices/water-machines` | `backend/src/routes/devices.js` |
| POST | `/api/devices/water-machines` | `backend/src/routes/devices.js` |
| DELETE | `/api/devices/water-machines/:id` | `backend/src/routes/devices.js` |
| GET | `/api/devices/water-machines/:id/maintenance` | `backend/src/routes/devices.js` |
| POST | `/api/devices/water-machines/:id/maintenance` | `backend/src/routes/devices.js` |
| GET | `/api/devices/water-quality` | `backend/src/routes/devices.js` |
| POST | `/api/devices/water-quality` | `backend/src/routes/devices.js` |
| GET | `/api/dialysis` | `backend/src/routes/dialysis.js` |
| POST | `/api/dialysis` | `backend/src/routes/dialysis.js` |
| GET | `/api/dialysis/:id` | `backend/src/routes/dialysis.js` |
| PATCH | `/api/dialysis/:id/note` | `backend/src/routes/dialysis.js` |
| POST | `/api/dialysis/:id/vitals` | `backend/src/routes/dialysis.js` |
| GET | `/api/dialysis/prepare` | `backend/src/routes/dialysis.js` |
| GET | `/api/dialysis/stats/daily` | `backend/src/routes/dialysis.js` |
| GET | `/api/dialysis/stats/ktv-trend/:patientId` | `backend/src/routes/dialysis.js` |
| GET | `/api/dialysis/stats/monthly` | `backend/src/routes/dialysis.js` |
| GET | `/api/guidelines` | `backend/src/routes/guidelines.js` |
| POST | `/api/guidelines` | `backend/src/routes/guidelines.js` |
| DELETE | `/api/guidelines/:id` | `backend/src/routes/guidelines.js` |
| GET | `/api/guidelines/:id` | `backend/src/routes/guidelines.js` |
| POST | `/api/guidelines/:id/generate-note` | `backend/src/routes/guidelines.js` |
| POST | `/api/guidelines/:id/save-to-kb` | `backend/src/routes/guidelines.js` |
| GET | `/api/guidelines/notices` | `backend/src/routes/guidelines.js` |
| POST | `/api/guidelines/notices/read-all` | `backend/src/routes/guidelines.js` |
| GET | `/api/infection/buttonhole-monitoring` | `backend/src/routes/infection.js` |
| POST | `/api/infection/monitoring` | `backend/src/routes/infection.js` |
| GET | `/api/infection/monitoring/:year/:month` | `backend/src/routes/infection.js` |
| POST | `/api/infection/monitoring/batch` | `backend/src/routes/infection.js` |
| GET | `/api/infection/screenings/:patientId` | `backend/src/routes/infection.js` |
| POST | `/api/infection/screenings/:patientId` | `backend/src/routes/infection.js` |
| GET | `/api/infection/screenings/:patientId/latest` | `backend/src/routes/infection.js` |
| POST | `/api/infection/screenings/latest/batch` | `backend/src/routes/infection.js` |
| GET | `/api/infection/screenings/overdue` | `backend/src/routes/infection.js` |
| GET | `/api/knowledge/documents` | `backend/src/routes/knowledge.js` |
| GET | `/api/knowledge/documents/:id` | `backend/src/routes/knowledge.js` |
| PATCH | `/api/knowledge/documents/:id` | `backend/src/routes/knowledge.js` |
| GET | `/api/labs` | `backend/src/routes/labs.js` |
| PATCH | `/api/labs/:id/critical-confirm` | `backend/src/routes/labs.js` |
| GET | `/api/labs/:patientId` | `backend/src/routes/labs.js` |
| POST | `/api/labs/:patientId` | `backend/src/routes/labs.js` |
| GET | `/api/labs/:patientId/latest` | `backend/src/routes/labs.js` |
| GET | `/api/labs/:patientId/trends` | `backend/src/routes/labs.js` |
| GET | `/api/labs/critical/unconfirmed` | `backend/src/routes/labs.js` |
| GET | `/api/labs/month-completion` | `backend/src/routes/labs.js` |
| GET | `/api/labs/overdue` | `backend/src/routes/labs.js` |
| GET | `/api/labs/recent` | `backend/src/routes/labs.js` |
| PATCH | `/api/labs/recheck` | `backend/src/routes/labs.js` |
| GET | `/api/labs/review-due-soon` | `backend/src/routes/labs.js` |
| GET | `/api/medical-sites` | `backend/src/routes/medicalSites.js` |
| PATCH | `/api/medical-sites/:siteKey` | `backend/src/routes/medicalSites.js` |
| POST | `/api/medical-sites/:siteKey/test` | `backend/src/routes/medicalSites.js` |
| POST | `/api/medical-sites/import-guidance` | `backend/src/routes/medicalSites.js` |
| PUT | `/api/orders/:orderId` | `backend/src/routes/orders.js` |
| PATCH | `/api/orders/:orderId/stop` | `backend/src/routes/orders.js` |
| POST | `/api/orders/:patientId` | `backend/src/routes/orders.js` |
| GET | `/api/orders/:patientId/active` | `backend/src/routes/orders.js` |
| GET | `/api/orders/:patientId/history` | `backend/src/routes/orders.js` |
| GET | `/api/orders/:patientId/today-tasks` | `backend/src/routes/orders.js` |
| POST | `/api/orders/execute` | `backend/src/routes/orders.js` |
| GET | `/api/orders/executions` | `backend/src/routes/orders.js` |
| GET | `/api/patients` | `backend/src/routes/patients.js` |
| POST | `/api/patients` | `backend/src/routes/patients.js` |
| DELETE | `/api/patients/:id` | `backend/src/routes/patients.js` |
| GET | `/api/patients/:id` | `backend/src/routes/patients.js` |
| PUT | `/api/patients/:id` | `backend/src/routes/patients.js` |
| GET | `/api/patients/:id/consent-dialysis-image` | `backend/src/routes/patients.js` |
| POST | `/api/patients/:id/consent-dialysis-image` | `backend/src/routes/patients.js` |
| GET | `/api/patients/:id/consent-dialysis-image/:index` | `backend/src/routes/patients.js` |
| PATCH | `/api/patients/:id/isolation` | `backend/src/routes/patients.js` |
| PATCH | `/api/patients/:id/status` | `backend/src/routes/patients.js` |
| POST | `/api/patients/import` | `backend/src/routes/patients.js` |
| POST | `/api/patients/import/auto` | `backend/src/routes/patients.js` |
| POST | `/api/patients/import/history-folder` | `backend/src/routes/patients.js` |
| GET | `/api/patients/import/template` | `backend/src/routes/patients.js` |
| GET | `/api/patients/stats` | `backend/src/routes/patients.js` |
| PATCH | `/api/prescriptions/:id/dry-weight` | `backend/src/routes/prescriptions.js` |
| POST | `/api/prescriptions/:patientId` | `backend/src/routes/prescriptions.js` |
| GET | `/api/prescriptions/:patientId/current` | `backend/src/routes/prescriptions.js` |
| GET | `/api/prescriptions/:patientId/history` | `backend/src/routes/prescriptions.js` |
| POST | `/api/prescriptions/check` | `backend/src/routes/prescriptions.js` |
| GET | `/api/reports/monthly-workload/:year/:month` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-routine/:year/:month` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-trend` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-upload/:year/:month` | `backend/src/routes/reports.js` |
| PATCH | `/api/reports/qc-upload/:year/:month` | `backend/src/routes/reports.js` |
| POST | `/api/reports/qc-upload/:year/:month/confirm` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-upload/:year/:month/export-pdf` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-upload/:year/:month/export` | `backend/src/routes/reports.js` |
| POST | `/api/reports/qc-upload/:year/:month/init` | `backend/src/routes/reports.js` |
| POST | `/api/reports/qc-upload/:year/:month/submit` | `backend/src/routes/reports.js` |
| GET | `/api/reports/qc-upload/history` | `backend/src/routes/reports.js` |
| GET | `/api/schedule/:patientId` | `backend/src/routes/schedule.js` |
| POST | `/api/schedule/generate-week` | `backend/src/routes/schedule.js` |
| POST | `/api/schedule/nurse-adjust` | `backend/src/routes/schedule.js` |
| GET | `/api/schedule/nurse-sheet` | `backend/src/routes/schedule.js` |
| PUT | `/api/schedule/nurse-sheet` | `backend/src/routes/schedule.js` |
| POST | `/api/schedule/rules` | `backend/src/routes/schedule.js` |
| POST | `/api/schedule/slots` | `backend/src/routes/schedule.js` |
| DELETE | `/api/schedule/slots/:id` | `backend/src/routes/schedule.js` |
| PATCH | `/api/schedule/slots/:id` | `backend/src/routes/schedule.js` |
| GET | `/api/schedule/today` | `backend/src/routes/schedule.js` |
| GET | `/api/schedule/week` | `backend/src/routes/schedule.js` |
| GET | `/api/users` | `backend/src/routes/users.js` |
| POST | `/api/users` | `backend/src/routes/users.js` |
| DELETE | `/api/users/:id` | `backend/src/routes/users.js` |
| PUT | `/api/users/:id` | `backend/src/routes/users.js` |
| PATCH | `/api/users/:id/password` | `backend/src/routes/users.js` |
| PATCH | `/api/users/:id/toggle-active` | `backend/src/routes/users.js` |
| GET | `/api/users/audit-logs` | `backend/src/routes/users.js` |
| GET | `/api/users/nursing-staff` | `backend/src/routes/users.js` |
| GET | `/api/vascular/:accessId/assessments` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:accessId/assessments` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:accessId/cvc-assessments` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:accessId/cvc-assessments` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:accessId/cvc-risk` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:accessId/cvc-risk` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:accessId/punctures` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:accessId/punctures` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:accessId/thrombolysis` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:accessId/thrombolysis` | `backend/src/routes/vascular.js` |
| POST | `/api/vascular/:patientId` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:patientId/current` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/:patientId/list` | `backend/src/routes/vascular.js` |
| PUT | `/api/vascular/access/:id` | `backend/src/routes/vascular.js` |
| PATCH | `/api/vascular/access/:id/abandon` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/cvc-all` | `backend/src/routes/vascular.js` |
| GET | `/api/vascular/factor-definitions` | `backend/src/routes/vascular.js` |

## Scheduled Jobs

| Cron | Source |
|---|---|
| `0 6 * * *` | `backend/src/jobs/scheduledTasks.js` |
| `0 8 1 * *` | `backend/src/jobs/scheduledTasks.js` |
| `0 9 * * 1` | `backend/src/jobs/scheduledTasks.js` |

## Migrations

总计：58 个迁移脚本

```text
001_create_users.sql
002_create_patients.sql
003_create_prescriptions.sql
004_create_long_term_orders.sql
005_create_order_executions.sql
006_create_dialysis_records.sql
007_create_vital_signs.sql
008_create_complications.sql
009_create_lab_results.sql
010_create_vascular_accesses.sql
011_create_thrombolysis_records.sql
012_create_cvc_risk_assessments.sql
013_create_infection_screenings.sql
014_create_infection_monitoring.sql
015_create_schedules.sql
016_create_devices.sql
017_create_water_quality.sql
018_create_consumables.sql
019_create_cqi.sql
020_create_qc_reports.sql
021_create_audit_alerts.sql
022_add_patient_history_fields.sql
023_devices_consumables_extend.sql
024_seed_consumable_catalog.sql
025_create_water_machines.sql
026_create_schedule_rules_and_nurse_schedule.sql
027_create_vascular_avf_assessments.sql
028_create_vascular_cvc_assessments.sql
029_create_vascular_punctures.sql
030_extend_cvc_risk_assessments.sql
031_users_role_add_quality.sql
032_knowledge_base_and_rules.sql
033_kb_tables_grants.sql
034_kb_ai_scenario_metadata.sql
035_medical_sites_and_guidelines.sql
036_cqi_records_align.sql
037_kb_schema_placeholder.sql
038_patient_dialysis_schedule_consent_image.sql
039_patient_responsible_nurse.sql
040_patient_consent_images_array.sql
041_user_menu_permissions.sql
042_patient_dialysis_schedule_anchor_date.sql
043_schedules_schedule_remark.sql
044_schedules_session_dialysis_mode.sql
045_prescriptions_hemodialysis_modality.sql
046_patients_profile_anticoagulant.sql
047_patients_profile_dry_weight.sql
048_prescriptions_hdf_replacement.sql
049_prescriptions_form_extra.sql
050_long_term_orders_combo_parent.sql
051_long_term_orders_frequency_add_tid.sql
052_user_guideline_notices.sql
053_patients_schedules_machine_station.sql
054_nurse_schedule_sheet.sql
055_water_quality_machine_and_daily_inspections.sql
056_patients_history_import_nullable.sql
057_patients_history_import_nullable_demographics.sql
058_users_role_add_technician.sql
```

## Medical Formula Anchors

| Key | Source | Line | Snippet |
|---|---|---:|---|
| ktv_threshold | `backend/src/routes/dialysis.js` | 94 | COUNT(*) FILTER (WHERE ktv >= 1.2)                as ktv_qualified_count, |
| uf_5pct_threshold | `backend/src/routes/dialysis.js` | 438 | if (ufPct !== null && ufPct > 5) { |
| daugirdas_formula | `backend/src/services/KtvCalculator.js` | 24 | const ktv = -Math.log(R - 0.008 * t) + (4 - 3.5 * R) * (UF / W); |
| ktv_threshold | `backend/src/services/KtvCalculator.js` | 30 | isKtvReached: ktv >= 1.2, |
| urr_threshold | `backend/src/services/KtvCalculator.js` | 31 | isUrrReached: urr >= 65, |
| ktv_threshold | `backend/src/services/QcRoutineMetricsService.js` | 41 | COUNT(*) FILTER (WHERE ktv >= 1.2)::int AS numer |
| urr_threshold | `backend/src/services/QcRoutineMetricsService.js` | 57 | COUNT(*) FILTER (WHERE urr >= 65)::int AS numer |
| uf_5pct_threshold | `frontend/src/pages/Dashboard/dashboardHelpers.ts` | 181 | const ufAlert = ufPct != null && ufPct > 5; |
| uf_5pct_threshold | `frontend/src/pages/Dialysis/DialysisEntry.tsx` | 2211 | const ufAlert = ufPercent ? parseFloat(ufPercent) > 5 : false; |
| ktv_threshold | `frontend/src/pages/Dialysis/DialysisEntry.tsx` | 2217 | const ktvAdequate = ktv !== null ? ktv >= 1.2 : null; |
| urr_threshold | `frontend/src/pages/Dialysis/DialysisEntry.tsx` | 2218 | const urrAdequate = urr !== null ? urr >= 65 : null; |
| uf_5pct_threshold | `frontend/src/pages/Prescription/PrescriptionWorkspace.tsx` | 124 | * 超滤量是否超过干体重 5%（与质控警示一致：ufMl / (dryKg×1000) > 5%） |
| uf_5pct_threshold | `frontend/src/pages/Prescription/PrescriptionWorkspace.tsx` | 722 | const ufAlertDialysis = ufPercentDialysis ? parseFloat(ufPercentDialysis) > 5 : false; |
| daugirdas_formula | `frontend/src/utils/ktv.ts` | 20 | const ktv = -Math.log(r - 0.008 * durationHours) + (4 - 3.5 * r) * (ufVolumeL / postWeightKg); |

