function validateConsumableCreatePayload(body) {
  const payload = body || {};
  const {
    item_name,
    category,
    specification,
    unit,
    dialyzer_flux,
    manufacturer,
    registration_no,
    storage_location,
    alert_threshold,
  } = payload;
  if (!item_name || !category || !unit) {
    return { ok: false, message: '品名、目录分类与单位为必填项' };
  }
  return {
    ok: true,
    value: {
      item_name,
      category,
      specification: specification || null,
      unit,
      dialyzer_flux: dialyzer_flux || null,
      manufacturer: manufacturer || null,
      registration_no: registration_no || null,
      storage_location: storage_location || null,
      alert_threshold: alert_threshold ?? 0,
    },
  };
}

function validateConsumableInboundPayload(body) {
  const payload = body || {};
  const {
    stock_item_id, quantity, lot_no, expiry_date, supplier, unit_price, notes,
  } = payload;
  if (!stock_item_id || !quantity || !lot_no) {
    return { ok: false, message: '耗材、数量、批号为必填项' };
  }
  return {
    ok: true,
    value: {
      stock_item_id,
      quantity,
      lot_no,
      expiry_date: expiry_date || null,
      supplier: supplier || null,
      unit_price: unit_price ?? null,
      notes: notes || null,
    },
  };
}

function normalizeConsumableOutboundLinesQuery(query) {
  const payload = query || {};
  const page = parseInt(payload.page || 1, 10);
  const pageSize = parseInt(payload.page_size || 30, 10);
  return {
    ok: true,
    value: {
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
      stock_item_id: payload.stock_item_id || null,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 30,
    },
  };
}

function validateConsumablePatientUsageQuery(query) {
  const payload = query || {};
  if (!payload.patient_id) return { ok: false, message: 'patient_id 必填' };
  return {
    ok: true,
    value: {
      patient_id: payload.patient_id,
      stock_item_id: payload.stock_item_id || null,
    },
  };
}

function validateConsumableStockPatchPayload(body) {
  const payload = body || {};
  const { quantity, notes, operation } = payload;
  if (quantity === undefined) return { ok: false, message: '数量为必填项' };
  return {
    ok: true,
    value: {
      quantity,
      notes,
      operation,
    },
  };
}

module.exports = {
  validateConsumableCreatePayload,
  validateConsumableInboundPayload,
  normalizeConsumableOutboundLinesQuery,
  validateConsumablePatientUsageQuery,
  validateConsumableStockPatchPayload,
};
