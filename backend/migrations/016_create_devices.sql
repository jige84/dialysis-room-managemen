-- 016_create_devices.sql
CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_no     VARCHAR(30) UNIQUE NOT NULL,
  device_name   VARCHAR(100) NOT NULL,
  device_type   VARCHAR(30) NOT NULL,
  manufacturer  VARCHAR(100),
  model         VARCHAR(100),
  serial_no     VARCHAR(100),
  purchase_date DATE,
  warranty_until DATE,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','maintenance','retired')),
  location      VARCHAR(50),
  total_hours   INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_maintenance (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id        UUID NOT NULL REFERENCES devices(id),
  maintenance_type VARCHAR(20) NOT NULL
                     CHECK (maintenance_type IN ('routine','repair','disinfect','calibration')),
  performed_date   DATE NOT NULL,
  description      TEXT NOT NULL,
  result           TEXT,
  performed_by     UUID REFERENCES users(id),
  vendor_name      VARCHAR(100),
  created_at       TIMESTAMP DEFAULT NOW()
);
