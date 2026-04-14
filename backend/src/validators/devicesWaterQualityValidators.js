const PG_UUID_TEXT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidText(value) {
  return typeof value === 'string' && PG_UUID_TEXT_RE.test(value.trim());
}

function normalizeWaterQualityListQuery(query) {
  const payload = query || {};
  if (payload.water_machine_id && !isUuidText(String(payload.water_machine_id))) {
    return { ok: false, message: 'water_machine_id 格式无效', statusCode: 400 };
  }
  const page = parseInt(payload.page || 1, 10);
  const pageSize = parseInt(payload.page_size || 20, 10);
  return {
    ok: true,
    value: {
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
      water_machine_id: payload.water_machine_id ? String(payload.water_machine_id).trim() : null,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
    },
  };
}

function normalizeWaterQualityCreatePayload(body) {
  const payload = body || {};
  const {
    test_date, test_type, sample_point,
    bacteria_count, endotoxin_value, conductivity,
    hardness, chlorine, result, notes,
    water_machine_id: waterMachineIdBody,
  } = payload;
  if (!test_date) return { ok: false, message: '检测日期为必填项' };

  const wmIdTrimmed = waterMachineIdBody ? String(waterMachineIdBody).trim() : '';
  if (waterMachineIdBody && !isUuidText(wmIdTrimmed)) {
    return { ok: false, message: 'water_machine_id 格式无效', statusCode: 400 };
  }

  const resolvedType = test_type
    || (bacteria_count !== undefined && bacteria_count !== null ? 'bacteria_water' : null)
    || (endotoxin_value !== undefined && endotoxin_value !== null ? 'endotoxin_water' : null);
  if (!resolvedType) {
    return { ok: false, message: 'test_type 必填，或至少提供 bacteria_count / endotoxin_value 之一', statusCode: 400 };
  }

  const numericValue = bacteria_count ?? endotoxin_value ?? null;
  const resultText = result || [conductivity, hardness, chlorine].filter((v) => v !== undefined && v !== null && v !== '').join(' / ') || null;
  const resultUnit = bacteria_count != null ? 'CFU/mL' : endotoxin_value != null ? 'EU/mL' : null;
  const isQualified = result === 'qualified'
    ? true
    : result === 'unqualified'
      ? false
      : null;

  return {
    ok: true,
    value: {
      test_date,
      test_type: resolvedType,
      sample_point: sample_point || '产水点',
      result_value: numericValue,
      result_unit: resultUnit,
      result_text: resultText,
      is_qualified: isQualified,
      notes: notes || null,
      water_machine_id: wmIdTrimmed || null,
      result_input: result || null,
    },
  };
}

module.exports = {
  normalizeWaterQualityListQuery,
  normalizeWaterQualityCreatePayload,
};
