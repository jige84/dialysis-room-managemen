const PG_UUID_TEXT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidText(value) {
  return typeof value === 'string' && PG_UUID_TEXT_RE.test(value.trim());
}

function validateWaterMachineCreatePayload(body) {
  const payload = body || {};
  if (!payload.machine_no) {
    return { ok: false, message: '水机编号为必填项' };
  }
  return {
    ok: true,
    value: {
      machine_no: payload.machine_no,
      model: payload.model || null,
      brand: payload.brand || null,
      location: payload.location || null,
      status: payload.status,
      last_disinfection_at: payload.last_disinfection_at || null,
      next_disinfection_due: payload.next_disinfection_due || null,
      notes: payload.notes || null,
    },
  };
}

function validateWaterMachineMaintenancePayload(body) {
  const payload = body || {};
  const { maintenance_type, maintenance_date, next_due, content, result, notes } = payload;
  if (!maintenance_type || !maintenance_date || !content) {
    return { ok: false, message: '维护类型、日期与内容为必填项' };
  }
  return {
    ok: true,
    value: {
      maintenance_type,
      maintenance_date,
      next_due: next_due || null,
      content,
      result: result || null,
      notes: notes || null,
    },
  };
}

function validateLegacyMaintenancePayload(body) {
  const payload = body || {};
  const {
    device_id, machine_id, maintenance_type, maintenance_date, next_due, content, result, notes,
  } = payload;
  const mid = machine_id || device_id;
  if (!mid || !maintenance_date || !content) {
    return { ok: false, message: '设备（machine_id）与维护日期、内容为必填项' };
  }
  return {
    ok: true,
    value: {
      machine_id: mid,
      maintenance_type: maintenance_type || 'routine',
      maintenance_date,
      next_due: next_due || null,
      content,
      result: result || null,
      notes: notes || null,
    },
  };
}

function normalizeMaintenanceListQuery(query) {
  const payload = query || {};
  const page = parseInt(payload.page || 1, 10);
  const pageSize = parseInt(payload.page_size || 20, 10);
  return {
    ok: true,
    value: {
      machine_id: payload.machine_id || null,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
    },
  };
}

function normalizeWaterDailyInspectionListQuery(query) {
  const payload = query || {};
  if (payload.water_machine_id && !isUuidText(String(payload.water_machine_id))) {
    return { ok: false, message: 'water_machine_id 格式无效', statusCode: 400 };
  }
  const page = parseInt(payload.page || 1, 10);
  const pageSize = parseInt(payload.page_size || 30, 10);
  return {
    ok: true,
    value: {
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
      water_machine_id: payload.water_machine_id ? String(payload.water_machine_id).trim() : null,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 30,
    },
  };
}

function validateWaterDailyInspectionCreatePayload(body) {
  const payload = body || {};
  const {
    water_machine_id,
    check_date,
    hardness, total_chlorine, tap_pressure,
    sand_delta_p, resin_delta_p, carbon_delta_p,
    ro_in_pressure, ro_out_pressure,
    feed_conductivity, product_conductivity,
    product_flow, drain_flow, feed_temp,
    operator, operator_name,
    notes,
  } = payload;

  if (!check_date) return { ok: false, message: '检测日期为必填项' };

  const wmIdResolved = water_machine_id ? String(water_machine_id).trim() : '';
  if (water_machine_id && !isUuidText(wmIdResolved)) {
    return { ok: false, message: 'water_machine_id 格式无效', statusCode: 400 };
  }

  return {
    ok: true,
    value: {
      water_machine_id: wmIdResolved || null,
      check_date,
      hardness: hardness || null,
      total_chlorine: total_chlorine || null,
      tap_pressure: tap_pressure || null,
      sand_delta_p: sand_delta_p || null,
      resin_delta_p: resin_delta_p || null,
      carbon_delta_p: carbon_delta_p || null,
      ro_in_pressure: ro_in_pressure || null,
      ro_out_pressure: ro_out_pressure || null,
      feed_conductivity: feed_conductivity || null,
      product_conductivity: product_conductivity || null,
      product_flow: product_flow || null,
      drain_flow: drain_flow || null,
      feed_temp: feed_temp || null,
      operator_name: operator_name || operator || null,
      notes: notes || null,
    },
  };
}

module.exports = {
  isUuidText,
  validateWaterMachineCreatePayload,
  validateWaterMachineMaintenancePayload,
  validateLegacyMaintenancePayload,
  normalizeMaintenanceListQuery,
  normalizeWaterDailyInspectionListQuery,
  validateWaterDailyInspectionCreatePayload,
};
