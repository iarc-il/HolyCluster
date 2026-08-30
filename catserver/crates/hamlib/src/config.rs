use crate::{ConfigDescriptor, ConfigValue, ConfigValueError};

impl ConfigDescriptor {
    pub fn parse_value(&self, value: &str) -> Result<ConfigValue, ConfigValueError> {
        let token = self.token().as_str().to_owned();
        let value = match self {
            Self::Text { .. } | Self::Path { .. } => ConfigValue::Text(value.to_owned()),
            Self::Integer { .. } => {
                let value = value.parse().map_err(|_| ConfigValueError::Invalid {
                    token: token.clone(),
                    expected: "an integer",
                })?;
                ConfigValue::Integer(value)
            }
            Self::Numeric { .. } => {
                let value = value.parse().map_err(|_| ConfigValueError::Invalid {
                    token: token.clone(),
                    expected: "a finite number",
                })?;
                ConfigValue::Numeric(value)
            }
            Self::Boolean { .. } => match value {
                "0" => ConfigValue::Boolean(false),
                "1" => ConfigValue::Boolean(true),
                _ => {
                    return Err(ConfigValueError::Invalid {
                        token,
                        expected: "0 or 1",
                    });
                }
            },
            Self::Combo { options, .. } => {
                if !options.iter().any(|option| option == value) {
                    return Err(ConfigValueError::InvalidOption { token });
                }
                ConfigValue::Combo(value.to_owned())
            }
        };
        self.validate(&value)?;
        Ok(value)
    }

    pub fn validate(&self, value: &ConfigValue) -> Result<(), ConfigValueError> {
        let token = self.token().as_str().to_owned();
        match (self, value) {
            (Self::Text { .. } | Self::Path { .. }, ConfigValue::Text(value)) => {
                text(value, &token)
            }
            (
                Self::Integer {
                    minimum,
                    maximum,
                    step,
                    ..
                },
                ConfigValue::Integer(value),
            ) => integer(*value, *minimum, *maximum, *step, &token),
            (
                Self::Numeric {
                    minimum,
                    maximum,
                    step,
                    ..
                },
                ConfigValue::Numeric(value),
            ) => numeric(*value, *minimum, *maximum, *step, &token),
            (Self::Boolean { .. }, ConfigValue::Boolean(_)) => Ok(()),
            (Self::Combo { options, .. }, ConfigValue::Combo(value)) if options.contains(value) => {
                text(value, &token)
            }
            (descriptor, _) => Err(ConfigValueError::Invalid {
                token,
                expected: descriptor.kind(),
            }),
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Text { .. } | Self::Path { .. } => "text",
            Self::Integer { .. } => "an integer",
            Self::Numeric { .. } => "a finite number",
            Self::Boolean { .. } => "a boolean",
            Self::Combo { .. } => "an allowed option",
        }
    }
}

impl ConfigValue {
    pub(crate) fn encoded(&self) -> String {
        match self {
            Self::Text(value) | Self::Combo(value) => value.clone(),
            Self::Integer(value) => value.to_string(),
            Self::Numeric(value) => value.to_string(),
            Self::Boolean(value) => i32::from(*value).to_string(),
        }
    }
}

fn text(value: &str, token: &str) -> Result<(), ConfigValueError> {
    if value.contains('\0') {
        Err(ConfigValueError::EmbeddedNul {
            token: token.to_owned(),
        })
    } else {
        Ok(())
    }
}

fn integer(
    value: i64,
    minimum: i64,
    maximum: i64,
    step: i64,
    token: &str,
) -> Result<(), ConfigValueError> {
    if step <= 0 {
        return Err(ConfigValueError::InvalidStep {
            token: token.to_owned(),
        });
    }
    if value < minimum || value > maximum {
        return Err(ConfigValueError::OutOfRange {
            token: token.to_owned(),
        });
    }
    if (value - minimum).rem_euclid(step) != 0 {
        return Err(ConfigValueError::InvalidStep {
            token: token.to_owned(),
        });
    }
    Ok(())
}

fn numeric(
    value: f64,
    minimum: f64,
    maximum: f64,
    step: f64,
    token: &str,
) -> Result<(), ConfigValueError> {
    if !minimum.is_finite() || !maximum.is_finite() || !step.is_finite() || step < 0.0 {
        return Err(ConfigValueError::InvalidStep {
            token: token.to_owned(),
        });
    }
    if !value.is_finite() || value < minimum || value > maximum {
        return Err(ConfigValueError::OutOfRange {
            token: token.to_owned(),
        });
    }
    if step > 0.0 {
        let steps = (value - minimum) / step;
        if (steps - steps.round()).abs() > f64::EPSILON * steps.abs().max(1.0) * 8.0 {
            return Err(ConfigValueError::InvalidStep {
                token: token.to_owned(),
            });
        }
    }
    Ok(())
}
