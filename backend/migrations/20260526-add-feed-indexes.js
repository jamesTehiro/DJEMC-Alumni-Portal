"use strict";

const hasTable = async (queryInterface, tableName) => {
    const tables = await queryInterface.showAllTables();

    return tables.some((table) => {
        if (typeof table === "string") return table.toLowerCase() === tableName.toLowerCase();
        if (table?.tableName) return String(table.tableName).toLowerCase() === tableName.toLowerCase();
        if (table?.TABLE_NAME) return String(table.TABLE_NAME).toLowerCase() === tableName.toLowerCase();
        return String(table).toLowerCase() === tableName.toLowerCase();
    });
};

const hasIndex = async (queryInterface, tableName, indexName) => {
    const indexes = await queryInterface.showIndex(tableName);
    return indexes.some((index) => index.name === indexName);
};

module.exports = {
    async up(queryInterface) {
        if (await hasTable(queryInterface, "Posts")) {
            if (!(await hasIndex(queryInterface, "Posts", "posts_created_at_idx"))) {
                await queryInterface.addIndex("Posts", ["createdAt"], {
                    name: "posts_created_at_idx"
                });
            }
        }

        if (await hasTable(queryInterface, "Comments")) {
            if (!(await hasIndex(queryInterface, "Comments", "comments_post_id_created_at_idx"))) {
                await queryInterface.addIndex("Comments", ["post_id", "createdAt"], {
                    name: "comments_post_id_created_at_idx"
                });
            }
        }
    },

    async down(queryInterface) {
        if (await hasTable(queryInterface, "Comments")) {
            if (await hasIndex(queryInterface, "Comments", "comments_post_id_created_at_idx")) {
                await queryInterface.removeIndex("Comments", "comments_post_id_created_at_idx");
            }
        }

        if (await hasTable(queryInterface, "Posts")) {
            if (await hasIndex(queryInterface, "Posts", "posts_created_at_idx")) {
                await queryInterface.removeIndex("Posts", "posts_created_at_idx");
            }
        }
    }
};
