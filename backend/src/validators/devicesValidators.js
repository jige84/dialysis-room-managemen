function validateMachineCreatePayload(body) {
  const payload = body || {};
  if (!payload.machine_no) {
    return { ok: false, message: '机器编号为必填项' };
  }
  return {
    ok: true,
    value: {
      machine_no: payload.machine_no,
      model: payload.model || null,
      brand: payload.brand || null,
      zone: payload.zone,
      status: payload.status,
      serial_no: payload.serial_no || null,
      purchase_date: payload.purchase_date || null,
      notes: payload.notes || null,
      bacterial_filter_installed_at: payload.bacterial_filter_installed_at || null,
      bacterial_filter_max_days: payload.bacterial_filter_max_days ?? null,
      last_dialysate_lab_at: payload.last_dialysate_lab_at || null,
      last_disinfection_at: payload.last_disinfection_at || null,
    },
  };
}

function buildMachinePatchPayload(body) {
  const payload = body || {};
  const allowed = [
    'model', 'brand', 'zone', 'status', 'serial_no', 'purchase_date', 'notes',
    'bacterial_filter_installed_at', 'bacterial_filter_max_days', 'last_dialysate_lab_at', 'last_disinfection_at',
  ];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (payload[key] !== undefined) {
      updates.push(key);
      values.push(payload[key]);
    }
  }
  if (updates.length === 0) {
    return { ok: false, message: '无有效更新字段' };
  }
  return { ok: true, value: { updates, values } };
}

function normalizeMachineStatusPayload(body) {
  const payload = body || {};
  return {
    ok: true,
    value: {
      status: payload.status,
      notes: payload.notes,
    },
  };
}

function validateMachineMaintenancePayload(body) {
  const payload = body || {};
  const {
    maintenance_type, maintenance_date, next_due, content, result, notes,
  } = payload;
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

function normalizeMachineAlertPayload(body) {
  const payload = body || {};
  const { alert_type, priority, severity, title, message } = payload;
  if (!title || !message) {
    return { ok: false, message: '标题与内容为必填项' };
  }
  return {
    ok: true,
    value: {
      alert_type: alert_type || 'machine_alarm',
      priority,
      severity,
      title,
      message,
    },
  };
}

module.exports = {
  validateMachineCreatePayload,
  buildMachinePatchPayload,
  normalizeMachineStatusPayload,
  validateMachineMaintenancePayload,
  normalizeMachineAlertPayload,
};
