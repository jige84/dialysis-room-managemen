-- 012_create_cvc_risk_assessments.sql
CREATE TABLE IF NOT EXISTS cvc_risk_assessments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vascular_access_id  UUID NOT NULL REFERENCES vascular_accesses(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  dialysis_record_id  UUID REFERENCES dialysis_records(id),
  assessed_at         DATE NOT NULL,
  factor_a_urokinase  BOOLEAN DEFAULT false,
  factor_b_thrombus   BOOLEAN DEFAULT false,
  factor_c_poor_flow  BOOLEAN DEFAULT false,
  factor_d_long_ncc   BOOLEAN DEFAULT false,
  factor_e_infection  BOOLEAN DEFAULT false,
  factor_f_ncc        BOOLEAN DEFAULT false,
  factor_f_tcc        BOOLEAN DEFAULT false,
  factor_g_femoral    BOOLEAN DEFAULT false,
  factor_g_jugular    BOOLEAN DEFAULT false,
  factor_h_in_situ    BOOLEAN DEFAULT false,
  factor_i_interv     BOOLEAN DEFAULT false,
  factor_j_age70      BOOLEAN DEFAULT false,
  factor_j_diabetes   BOOLEAN DEFAULT false,
  total_score         SMALLINT NOT NULL,
  risk_grade          SMALLINT NOT NULL CHECK (risk_grade IN (1,2,3)),
  assessed_by         UUID NOT NULL REFERENCES users(id),
  intervention_notes  TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cvc_risk_access ON cvc_risk_assessments(vascular_access_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cvc_risk_grade3 ON cvc_risk_assessments(risk_grade) WHERE risk_grade = 3;
