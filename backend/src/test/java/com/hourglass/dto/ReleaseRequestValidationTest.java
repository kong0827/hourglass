package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import javax.validation.ConstraintViolation;
import javax.validation.Validation;
import javax.validation.Validator;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 发布链路的 400 必须点出缺的是哪个字段，否则调用方只能靠猜。 */
class ReleaseRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void previewRejectsEachMissingFieldByName() {
        ReleasePreviewRequest missing = new ReleasePreviewRequest();
        assertNamesField("occurredAt", validator.validate(missing));

        missing.setOccurredAt(OffsetDateTime.now());
        assertNamesField("environment", validator.validate(missing));

        missing.setEnvironment("production");
        assertNamesField("targetKeys", validator.validate(missing));

        missing.setTargetKeys(Collections.singletonList("cluster-east"));
        assertNamesField("coverage", validator.validate(missing));

        missing.setCoverage("full");
        assertNamesField("artifactRef", validator.validate(missing));

        missing.setArtifactRef("release/app");
        assertNamesField("artifactDigest", validator.validate(missing));

        missing.setArtifactDigest(repeat('a', 64));
        assertNamesField("operation", validator.validate(missing));

        missing.setOperation("deploy");
        assertNamesField("actualTaskIds", validator.validate(missing));

        missing.setActualTaskIds(Collections.singletonList("Ktask"));
        assertNamesField("executorUserId", validator.validate(missing));

        missing.setExecutorUserId("Uowner");
        assertTrue(validator.validate(missing).isEmpty(), "完整预览请求应当合法");
    }

    @Test
    void previewRejectsMalformedEnumAndDigest() {
        ReleasePreviewRequest req = validPreview();
        req.setEnvironment("prod");
        assertViolationLabel("environment", "发布环境", validator.validate(req));

        req.setEnvironment("production");
        req.setArtifactDigest(repeat('z', 64));
        assertViolationLabel("artifactDigest", "制品摘要", validator.validate(req));

        req.setArtifactDigest(repeat('a', 64));
        req.setOperation("rollback-and-retry");
        assertViolationLabel("operation", "操作类型", validator.validate(req));

        req.setOperation("rollback");
        req.setTargetKeys(Collections.singletonList(""));
        assertViolationLabel("targetKeys", "发布目标", validator.validate(req));
    }

    @Test
    void confirmRequiresIdempotencyKeyAndScopeToken() {
        ReleaseConfirmRequest req = new ReleaseConfirmRequest();
        copyInto(validPreview(), req);
        assertNamesField("result", validator.validate(req));

        req.setResult("success");
        assertNamesField("idempotencyKey", validator.validate(req));

        req.setIdempotencyKey("rel-2026-11-10-001");
        assertNamesField("scopeToken", validator.validate(req));

        req.setScopeToken(repeat('A', 64));
        assertViolationLabel("scopeToken", "scopeToken", validator.validate(req));

        req.setScopeToken(repeat('a', 64));
        assertTrue(validator.validate(req).isEmpty(), "完整确认请求应当合法");
    }

    @Test
    void planRequiresTasksEnvironmentAndTargets() {
        ReleasePlanRequest req = new ReleasePlanRequest();
        assertNamesField("plannedTaskIds", validator.validate(req));

        req.setPlannedTaskIds(Collections.singletonList("Ktask"));
        assertNamesField("environment", validator.validate(req));

        req.setEnvironment("staging");
        assertNamesField("targetKeys", validator.validate(req));

        req.setTargetKeys(Collections.singletonList("cluster-east"));
        assertNamesField("coverage", validator.validate(req));

        req.setCoverage("partial");
        req.setStatus("archived");
        assertViolationLabel("status", "计划状态", validator.validate(req));

        req.setStatus("ready");
        assertTrue(validator.validate(req).isEmpty(), "完整计划请求应当合法");
    }

    private ReleasePreviewRequest validPreview() {
        ReleasePreviewRequest req = new ReleasePreviewRequest();
        req.setOccurredAt(OffsetDateTime.now());
        req.setEnvironment("production");
        req.setTargetKeys(Collections.singletonList("cluster-east"));
        req.setCoverage("full");
        req.setArtifactRef("release/app-1.0.0");
        req.setArtifactDigest(repeat('a', 64));
        req.setOperation("deploy");
        req.setActualTaskIds(Collections.singletonList("Ktask"));
        req.setExecutorUserId("Uowner");
        return req;
    }

    private void copyInto(ReleasePreviewRequest src, ReleaseConfirmRequest dst) {
        dst.setPlanId(src.getPlanId());
        dst.setOccurredAt(src.getOccurredAt());
        dst.setEnvironment(src.getEnvironment());
        dst.setTargetKeys(src.getTargetKeys());
        dst.setCoverage(src.getCoverage());
        dst.setArtifactRef(src.getArtifactRef());
        dst.setArtifactDigest(src.getArtifactDigest());
        dst.setOperation(src.getOperation());
        dst.setRelatedReleaseId(src.getRelatedReleaseId());
        dst.setActualTaskIds(src.getActualTaskIds());
        dst.setExecutorUserId(src.getExecutorUserId());
        dst.setDeviationReason(src.getDeviationReason());
    }

    /** 缺字段：提示里必须点出这个 JSON 字段名，而不是默认的「不能为空」。 */
    private void assertNamesField(String jsonField, Set<? extends ConstraintViolation<?>> violations) {
        boolean namesField = violations.stream()
                .filter(v -> v.getPropertyPath().toString().equals(jsonField))
                .anyMatch(v -> v.getMessage().contains(jsonField));
        assertTrue(namesField, jsonField + " 的 400 未点出字段名：" + violations);
    }

    /** 值不合法：只报这一条，且说明这是哪个字段、合法值是什么（数组元素路径形如 targetKeys[0]…）。 */
    private void assertViolationLabel(String fieldPath, String label,
                                      Set<? extends ConstraintViolation<?>> violations) {
        List<String> messages = violations.stream()
                .filter(v -> {
                    String path = v.getPropertyPath().toString();
                    return path.equals(fieldPath) || path.startsWith(fieldPath + "[");
                })
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toList());
        assertEquals(1, messages.size(), violations.toString());
        assertTrue(messages.get(0).contains(label), messages.get(0));
    }

    private String repeat(char c, int count) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < count; i++) {
            value.append(c);
        }
        return value.toString();
    }
}
