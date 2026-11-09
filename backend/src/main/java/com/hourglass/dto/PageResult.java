package com.hourglass.dto;

import lombok.Data;

import java.util.List;

@Data
public class PageResult<T> {

    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private List<T> items;

    public static <T> PageResult<T> of(List<T> items, int total, int offset, int limit) {
        PageResult<T> page = new PageResult<T>();
        page.setTotal(total);
        page.setOffset(offset);
        page.setLimit(limit);
        page.setItems(items);
        page.setHasMore(offset + items.size() < total);
        return page;
    }
}
