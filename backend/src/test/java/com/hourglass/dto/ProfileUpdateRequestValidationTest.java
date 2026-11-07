package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import javax.validation.ConstraintViolation;
import javax.validation.Validation;
import javax.validation.Validator;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProfileUpdateRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void nullableEmailIsAllowed() {
        ProfileUpdateRequest req = new ProfileUpdateRequest();
        req.setDisplayName("User");
        req.setEmail(null);
        assertTrue(validator.validate(req).isEmpty());
    }

    @Test
    void malformedAndOverlongEmailsAreRejected() {
        ProfileUpdateRequest req = new ProfileUpdateRequest();
        req.setDisplayName("User");
        req.setEmail("not-an-email");
        Set<ConstraintViolation<ProfileUpdateRequest>> invalid = validator.validate(req);
        assertFalse(invalid.isEmpty());

        req.setEmail(repeat('a', 246) + "@test.com");
        assertFalse(validator.validate(req).isEmpty());
    }

    private String repeat(char c, int count) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < count; i++) {
            value.append(c);
        }
        return value.toString();
    }
}
