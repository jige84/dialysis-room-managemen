-- 025_create_water_machines.sql
-- 水机台账与维护记录

CREATE TABLE IF NOT EXISTS water_machines (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_no            VARCHAR(50) NOT NULL UNIQUE,
  model                 VARCHAR(100),
  brand                 VARCHAR(100),
  location              VARCHAR(100),
  status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','maintenance','retired','fault')),
  last_disinfection_at  DATE,
  next_disinfection_due DATE,
  last_water_test_date  DATE,
  last_water_test_result VARCHAR(20),
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS water_machine_maintenance (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  water_machine_id  UUID NOT NULL REFERENCES water_machines(id) ON DELETE CASCADE,
  maintenance_type  VARCHAR(30) NOT NULL
                      CHECK (maintenance_type IN ('routine','disinfect','repair')),
  maintenance_date  DATE NOT NULL,
  next_due          DATE,
  content           TEXT NOT NULL,
  result            TEXT,
  notes             TEXT,
  maintained_by     UUID REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_machines_no ON water_machines(machine_no);
CREATE INDEX IF NOT EXISTS idx_water_maint_machine ON water_machine_maintenance(water_machine_id, maintenance_date DESC);

