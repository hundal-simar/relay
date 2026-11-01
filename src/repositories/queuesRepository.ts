import  { pool } from "../db";


interface QueueRow{
    id: number;
    name: string;
    created_at: Date;
}

export const findQueueByName = async (name: string): Promise<QueueRow | null> => {
    const query = 'SELECT * FROM queues WHERE name = $1';
    const values = [name];
    const result = await pool.query<QueueRow>(query, values);
    return result.rows[0] || null;
};

