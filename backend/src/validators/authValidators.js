const Joi = require('joi');

const loginSchema = Joi.object({
  username: Joi.string().required().label('用户名'),
  password: Joi.string().required().label('密码'),
});

const changePasswordSchema = Joi.object({
  old_password: Joi.string().required().label('旧密码'),
  new_password: Joi.string().required().label('新密码'),
});

function validateLoginPayload(body) {
  const { error, value } = loginSchema.validate(body || {});
  if (error) {
    return { ok: false, message: error.details[0].message };
  }
  return { ok: true, value };
}

function validateChangePasswordPayload(body) {
  const { error, value } = changePasswordSchema.validate(body || {});
  if (error) {
    return { ok: false, message: '请提供旧密码和新密码' };
  }
  return { ok: true, value };
}

module.exports = {
  validateLoginPayload,
  validateChangePasswordPayload,
};

