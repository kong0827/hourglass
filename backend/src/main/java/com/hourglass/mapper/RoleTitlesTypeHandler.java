package com.hourglass.mapper;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

/** 项目兼岗 JSON 数组；SQL NULL 保持为 null，由花名册统一输出空数组。 */
public class RoleTitlesTypeHandler extends BaseTypeHandler<List<String>> {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, List<String> value, JdbcType type)
            throws SQLException {
        try {
            ps.setString(i, JSON.writeValueAsString(value));
        } catch (Exception e) {
            throw new SQLException("Cannot serialize secondary role titles", e);
        }
    }

    private List<String> parse(String json) throws SQLException {
        if (json == null) return null;
        try {
            return JSON.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            throw new SQLException("Invalid secondary role titles JSON", e);
        }
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, String column) throws SQLException {
        return parse(rs.getString(column));
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, int column) throws SQLException {
        return parse(rs.getString(column));
    }

    @Override
    public List<String> getNullableResult(CallableStatement cs, int column) throws SQLException {
        return parse(cs.getString(column));
    }
}
