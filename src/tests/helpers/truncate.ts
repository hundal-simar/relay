import {pool} from "../../db";

export const truncateTables = async () => {
     await pool.query(`
    TRUNCATE TABLE jobs, queues
    RESTART IDENTITY
    CASCADE
  `);
}