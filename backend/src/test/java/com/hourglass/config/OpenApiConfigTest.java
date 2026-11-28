package com.hourglass.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.QueryParameter;
import io.swagger.v3.oas.models.media.StringSchema;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenApiConfigTest {

    private final OpenAPI openApi = new OpenAPI().paths(new Paths());

    private static Parameter query(String name) {
        return new QueryParameter().name(name).required(true).schema(new StringSchema());
    }

    private OpenAPI customise() {
        new OpenApiConfig().readOnlyCustomiser().customise(openApi);
        return openApi;
    }

    private static List<String> names(Operation operation) {
        List<String> names = new ArrayList<String>();
        for (Parameter param : operation.getParameters()) {
            names.add(param.getName());
        }
        return names;
    }

    @Test
    void replacesResolverPlaceholdersWithRealQueryParameters() {
        Operation operation = new Operation().parameters(new ArrayList<Parameter>(Arrays.asList(
                query("ctx"), query("query"), query("sort"), query("offset"), query("limit"), query("open"))));
        openApi.getPaths().addPathItem("/api/tasks/list", new PathItem().get(operation));

        Operation fixed = customise().getPaths().get("/api/tasks/list").getGet();

        List<String> names = names(fixed);
        assertFalse(names.contains("ctx"));
        assertFalse(names.contains("query"));
        assertTrue(names.contains("workspace"));
        assertTrue(names.containsAll(Arrays.asList("q", "owners", "pris", "types", "reqs", "versions", "due",
                "completion", "doneScope", "doneLimit", "doneOffset", "openLimit")));
        assertTrue(names.containsAll(Arrays.asList("sort", "offset", "limit", "open")));
        assertEquals(names.size(), new java.util.HashSet<String>(names).size());
    }

    @Test
    void keepsExplicitWorkspaceParameterAndPlainOperationsUntouched() {
        openApi.getPaths().addPathItem("/api/projects", new PathItem()
                .get(new Operation().parameters(new ArrayList<Parameter>(Arrays.asList(
                        query("workspace"), query("offset"), query("limit"))))));
        openApi.getPaths().addPathItem("/api/demands/{id}", new PathItem()
                .get(new Operation().parameters(new ArrayList<Parameter>(Arrays.asList(query("ctx"))))));

        OpenAPI result = customise();

        Operation projects = result.getPaths().get("/api/projects").getGet();
        assertEquals(Arrays.asList("workspace", "offset", "limit"), names(projects));

        Operation demand = result.getPaths().get("/api/demands/{id}").getGet();
        assertEquals(Arrays.asList("workspace"), names(demand));
    }

    @Test
    void removesNonGetOperationsAndEmptyPaths() {
        openApi.getPaths().addPathItem("/api/demands", new PathItem()
                .get(new Operation().parameters(new ArrayList<Parameter>(Arrays.asList(query("q")))))
                .post(new Operation()));
        openApi.getPaths().addPathItem("/api/auth/tokens", new PathItem().post(new Operation()));

        OpenAPI result = customise();

        assertTrue(result.getPaths().containsKey("/api/demands"));
        assertNull(result.getPaths().get("/api/demands").getPost());
        assertFalse(result.getPaths().containsKey("/api/auth/tokens"));
    }
}