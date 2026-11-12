package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import javax.validation.ConstraintViolation;
import javax.validation.Validation;
import javax.validation.Validator;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MailSettingsRequestTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void rejectsDisplayNameAsUsername() {
        MailSettingsRequest req = new MailSettingsRequest();
        req.setEnabled(false);
        req.setUsername("沙漏");

        assertFalse(validator.validate(req).isEmpty());
    }

    @Test
    void acceptsFullMailboxAsUsernameAndEmptyWhenUnset() {
        MailSettingsRequest req = new MailSettingsRequest();
        req.setEnabled(false);
        req.setUsername("operations_service@orientfutures.com");

        assertTrue(validator.validate(req).isEmpty());

        req.setUsername("");
        Set<String> messages = validator.validate(req).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
        assertTrue(messages.isEmpty(), messages.toString());
    }
}
